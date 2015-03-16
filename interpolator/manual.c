#include "stm32f4xx_conf.h"
#include "stm32f4_discovery.h"
#include "arm_math.h"
#include "cnc.h"

static const struct {
    GPIO_TypeDef *gpio;
    uint16_t manualButton, xControl, yControl, zControl;
    int8_t xOrientation, yOrientation, zOrientation;
} uiPinout = {
        .gpio = GPIOA,
        .manualButton = GPIO_Pin_0,
        .xControl = GPIO_Pin_1,
        .yControl = GPIO_Pin_2,
        .zControl = GPIO_Pin_3,
        .xOrientation = 1,
        .yOrientation = 1,
        .zOrientation = 1};

static volatile struct {
    float32_t x, y, z;
    float32_t deadzoneRadius;
    float32_t snapOnAxisRadius;
    float32_t maxAcceleration;
    int32_t minFeed;
    int32_t maxFeed;
    uint8_t zeroX, zeroY, zeroZ;
    uint64_t lastTick;
    vec3f_t lastSpeed;
    volatile __attribute__((aligned (4))) uint8_t adcValue[3];
} manualControlStatus = {
        .deadzoneRadius = 0.12F,
        .snapOnAxisRadius = 0.70F,
        .maxAcceleration = 150,
        .minFeed = 5,
        .maxFeed = 8000,
        .zeroX = 128,
        .zeroY = 128,
        .zeroZ = 128,
        .lastTick = 0,
        .lastSpeed = {0, 0, 0},
        .adcValue = {0, 0, 0}};

static float32_t norm(vec3f_t vector) {
    //fuck [golberg91]
    return sqrtf(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
}

static char findMajorAxis(vec3f_t vector) {
    float32_t absX = fabsf(vector.x), absY = fabsf(vector.y), absZ = fabsf(vector.z);
    return absX >= absY && absX >= absZ ? 'x' : (absY >= absX && absY >= absZ ? 'y' : 'z');
}

static vec3f_t snapAxes(vec3f_t speedVector) {
    char majorAxis = findMajorAxis(speedVector);
    //is always alone
    if (majorAxis == 'z')
        return (vec3f_t) {.z = speedVector.z};
    else
        speedVector.z = 0;
    if (norm(speedVector) > manualControlStatus.snapOnAxisRadius)
        return speedVector;
    return majorAxis == 'x' ? (vec3f_t) {.x = speedVector.x} : (vec3f_t) {.y = speedVector.y};
}

static vec3f_t joystick2speed(vec3f_t joystickPosition) {
    float32_t magnitude = norm(joystickPosition);
    if (magnitude == 0)
        return joystickPosition;
    float32_t minSpeed = manualControlStatus.minFeed / 60.0F;
    float32_t maxSpeed = manualControlStatus.maxFeed / 60.0F;
    float32_t ratio = powf(maxSpeed, magnitude) * powf(minSpeed, (1 - magnitude));
    return (vec3f_t) {joystickPosition.x * ratio, joystickPosition.y * ratio, joystickPosition.z * ratio};
}

static uint16_t deadlineForDate(float32_t speed, uint64_t date) {
    uint64_t period = (uint64_t) (cncMemory.parameters.clockFrequency / fabsf(speed) / cncMemory.parameters.stepsPerMillimeter);
    return (uint16_t) (period - date % period);
}

static step_t nextStep(vec3f_t speed, uint64_t date) {
    step_t result = {
            .duration = 0,
            .axes = {
                    .xDirection = (uint8_t) (speed.x > 0),
                    .yDirection = (uint8_t) (speed.y > 0),
                    .zDirection = (uint8_t) (speed.z > 0)}};
    if (speed.x != 0) {
        result.duration = deadlineForDate(speed.x, date);
        result.axes.xStep = 1;
    }
    if (speed.y != 0) {
        uint16_t deadlineY = deadlineForDate(speed.y, date);
        if (deadlineY <= result.duration || result.duration == 0) {
            result.axes.yStep = 1;
            if (deadlineY < result.duration)
                result.axes.xStep = 0;
            result.duration = deadlineY;
        }
    }
    if (speed.z != 0) {
        uint16_t deadlineZ = deadlineForDate(speed.z, date);
        if (deadlineZ <= result.duration || result.duration == 0) {
            result.axes.zStep = 1;
            if (deadlineZ < result.duration) {
                result.axes.xStep = 0;
                result.axes.yStep = 0;
            }
            result.duration = deadlineZ;
        }
    }
    return result;
}

static vec3f_t clampPositionTo1(vec3f_t joystickPosition) {
    float32_t magnitude = norm(joystickPosition);
    if (magnitude > 1)
        return (vec3f_t) {joystickPosition.x / magnitude, joystickPosition.y / magnitude, joystickPosition.z / magnitude};
    return joystickPosition;
}

static vec3f_t deadZoneJoystick(vec3f_t joystickPosition) {
    float32_t magnitude = norm(joystickPosition);
    float32_t factor = (magnitude - manualControlStatus.deadzoneRadius) / (1 - manualControlStatus.deadzoneRadius) / magnitude;
    if (factor <= 0 || !isfinite(factor))
        factor = 0;
    return (vec3f_t) {joystickPosition.x * factor, joystickPosition.y * factor, joystickPosition.z * factor};
}

step_t nextManualStep() {
    uint64_t currentTick = cncMemory.tick;
    vec3f_t joystickPosition = {
            .x = (manualControlStatus.adcValue[0] - manualControlStatus.zeroX) / 128.0F * uiPinout.xOrientation,
            .y = (manualControlStatus.adcValue[1] - manualControlStatus.zeroY) / 128.0F * uiPinout.yOrientation,
            .z = (manualControlStatus.adcValue[2] - manualControlStatus.zeroZ) / 128.0F * uiPinout.zOrientation};
    joystickPosition = clampPositionTo1(joystickPosition);
    joystickPosition = deadZoneJoystick(joystickPosition);
    joystickPosition = snapAxes(joystickPosition);
    vec3f_t speed = joystick2speed(joystickPosition);
    step_t result = nextStep(speed, currentTick);
    manualControlStatus.lastSpeed = speed;
    manualControlStatus.lastTick = currentTick;
    return result;
}

void zeroJoystick() {
    manualControlStatus.zeroX = manualControlStatus.adcValue[0];
    manualControlStatus.zeroY = manualControlStatus.adcValue[1];
    manualControlStatus.zeroZ = manualControlStatus.adcValue[2];
}

uint32_t toggleManualMode() {
    switch (cncMemory.state) {
        case READY:
            STM_EVAL_LEDOn(LED3);
            zeroJoystick();
            cncMemory.state = MANUAL_CONTROL;
            executeNextStep();
            sendEvent(ENTER_MANUAL_MODE);
            return 1;
        case MANUAL_CONTROL:
            STM_EVAL_LEDOff(LED3);
            cncMemory.state = READY;
            sendEvent(EXIT_MANUAL_MODE);
            return 1;
        default:
            return 0;
    }
}

void initManualControls() {
    RCC_AHB1PeriphClockCmd(RCC_AHB1Periph_GPIOA, ENABLE);
    GPIO_Init(uiPinout.gpio, &(GPIO_InitTypeDef) {
            .GPIO_Pin = uiPinout.manualButton,
            .GPIO_Mode = GPIO_Mode_IN,
            .GPIO_PuPd = GPIO_PuPd_NOPULL});
    GPIO_Init(uiPinout.gpio, &(GPIO_InitTypeDef) {
            .GPIO_Pin = uiPinout.xControl | uiPinout.yControl | uiPinout.zControl,
            .GPIO_Mode = GPIO_Mode_AN,
            .GPIO_PuPd = GPIO_PuPd_NOPULL});
    RCC_APB2PeriphClockCmd(RCC_APB2Periph_ADC1, ENABLE);
    RCC_AHB1PeriphClockCmd(RCC_AHB1Periph_DMA2, ENABLE);
    ADC_CommonInit(&(ADC_CommonInitTypeDef) {
            .ADC_Mode = ADC_Mode_Independent,
            .ADC_Prescaler = ADC_Prescaler_Div8,
            .ADC_DMAAccessMode = ADC_DMAAccessMode_Disabled,
            .ADC_TwoSamplingDelay = ADC_TwoSamplingDelay_20Cycles});
    ADC_Init(ADC1, &(ADC_InitTypeDef) {
            .ADC_Resolution = ADC_Resolution_8b,
            .ADC_ScanConvMode = ENABLE,
            .ADC_ContinuousConvMode = ENABLE,
            .ADC_ExternalTrigConvEdge = ADC_ExternalTrigConvEdge_None,
            .ADC_DataAlign = ADC_DataAlign_Right,
            .ADC_NbrOfConversion = 3});
    DMA_Init(DMA2_Stream0, &(DMA_InitTypeDef) {
            .DMA_Channel = DMA_Channel_0,
            .DMA_PeripheralBaseAddr = (uint32_t) &(ADC1->DR),
            .DMA_Memory0BaseAddr = (uint32_t) manualControlStatus.adcValue,
            .DMA_DIR = DMA_DIR_PeripheralToMemory,
            .DMA_BufferSize = sizeof(manualControlStatus.adcValue),
            .DMA_PeripheralInc = DMA_PeripheralInc_Disable,
            .DMA_MemoryInc = DMA_MemoryInc_Enable,
            .DMA_PeripheralDataSize = DMA_PeripheralDataSize_Byte,
            .DMA_MemoryDataSize = DMA_MemoryDataSize_Byte,
            .DMA_Mode = DMA_Mode_Circular,
            .DMA_Priority = DMA_Priority_High,
            .DMA_FIFOMode = DMA_FIFOMode_Disable,
            .DMA_FIFOThreshold = DMA_FIFOThreshold_HalfFull,
            .DMA_MemoryBurst = DMA_MemoryBurst_Single,
            .DMA_PeripheralBurst = DMA_PeripheralBurst_Single});
    DMA_Cmd(DMA2_Stream0, ENABLE);
    ADC_RegularChannelConfig(ADC1, ADC_Channel_1, 1, ADC_SampleTime_3Cycles);
    ADC_RegularChannelConfig(ADC1, ADC_Channel_2, 2, ADC_SampleTime_3Cycles);
    ADC_RegularChannelConfig(ADC1, ADC_Channel_3, 3, ADC_SampleTime_3Cycles);
    ADC_DMARequestAfterLastTransferCmd(ADC1, ENABLE);
    ADC_DMACmd(ADC1, ENABLE);
    ADC_Cmd(ADC1, ENABLE);
    ADC_SoftwareStartConv(ADC1);
}

#define UI_DEBOUNCE_MAX_CHECKS 50
#define SYSTICK_UI_DEBOUNCE_SCALING_FACTOR 50

void periodicUICallback(void) {
    static uint8_t previousDebouncedValue;
    static uint8_t stableValueTicks = 0;
    static uint8_t lastRawValue;
    if (cncMemory.tick % SYSTICK_UI_DEBOUNCE_SCALING_FACTOR == 0) {
        uint8_t rawValue = GPIO_ReadInputDataBit(uiPinout.gpio, uiPinout.manualButton);
        if (rawValue == lastRawValue) {
            if (stableValueTicks < UI_DEBOUNCE_MAX_CHECKS)
                stableValueTicks++;
            else {
                if (rawValue && !previousDebouncedValue)
                    toggleManualMode();
                previousDebouncedValue = rawValue;
            }
        } else
            stableValueTicks = 1;
        lastRawValue = rawValue;
    }
}