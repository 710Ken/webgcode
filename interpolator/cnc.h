#pragma once

typedef struct __attribute__((__packed__)) {
    uint32_t stepsPerMillimeter, maxSpeed, maxAcceleration, clockFrequency;
} parameters_t;

typedef struct __attribute__((__packed__)) {
    int32_t x, y, z, speed;
} position_t;

typedef struct __attribute__((packed)) {
    uint8_t xStep, xDirection;
    uint8_t yStep, yDirection;
    uint8_t zStep, zDirection;
} axes_t;

typedef struct {
    uint16_t duration;
    axes_t axes;
} step_t;


typedef struct {
    position_t position;
    parameters_t parameters;
    uint32_t state;
    int32_t lastEvent[4];
    step_t currentStep;
    uint8_t running;
    uint64_t tick;
} cnc_memory_t;

typedef enum {
    EP_IN = 0b10000000U,
    EP_OUT = 0b00000000U
} EndpointDirection_t;

typedef enum {
    READY = 0,
    RUNNING_PROGRAM = 1,
    MANUAL_CONTROL = 2
} cnc_state_t;

enum {
    NULL_EVENT = 0,
    PROGRAM_END = 1,
    PROGRAM_START = 2,
    MOVED = 3,
    ENTER_MANUAL_MODE = 4,
    EXIT_MANUAL_MODE = 5
};

#define INTERRUPT_PACKET_SIZE         24
#define INTERRUPT_ENDPOINT_NUM        1
#define INTERRUPT_ENDPOINT_DIR        EP_IN
#define INTERRUPT_ENDPOINT            (INTERRUPT_ENDPOINT_DIR|INTERRUPT_ENDPOINT_NUM)

#define BULK_PACKET_SIZE              64
#define BULK_ENDPOINT_NUM             1
#define BULK_ENDPOINT_DIR             EP_OUT
#define BULK_ENDPOINT                 (BULK_ENDPOINT_DIR|BULK_ENDPOINT_NUM)

extern volatile cnc_memory_t cncMemory;

extern void executeNextStep();

extern void initUSB();

extern uint8_t readBuffer();

extern void sendEvent(uint32_t event);

extern uint8_t *cncGetCfgDesc(uint8_t speed, uint16_t *length);

extern void zeroJoystick();

extern step_t nextManualStep();

extern void initManualControls();

extern uint32_t toggleManualMode();