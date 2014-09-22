"use strict";
define(['RSVP', 'jQuery', 'Ember', 'connection', 'runner' ], function (rsvp, $, Ember, Connection, Runner) {
    var CONTROL_COMMANDS = {REQUEST_POSITION: 0, REQUEST_PARAMETERS: 1, REQUEST_STATE: 2, REQUEST_TOGGLE_MANUAL_STATE: 3,
        REQUEST_DEFINE_AXIS_POSITION: 4};
    var EVENTS = {PROGRAM_END: 1, PROGRAM_START: 2, MOVED: 3, ENTER_MANUAL_MODE: 4, EXIT_MANUAL_MODE: 5};
    var STATES = {READY: 0, RUNNING_PROGRAM: 1, MANUAL_CONTROL: 2};
    var Axis = Ember.Object.extend({
        name: null,
        position: 0,
        machine: null,
        definePosition: function (newPosition) {
            this.get('machine').setAxisValue(this.get('name'), newPosition);
        }
    });

    var CNCMachine = Ember.Object.extend({
        init: function () {
            var _this = this;
            var connection = Connection.create();
            this.set('connection', connection);
            this.set('runner', new Runner(connection));
            this.set('axes', ['X', 'Y', 'Z'].map(function (name) {
                return Axis.create({name: name, machine: _this});
            }));
            this.connect();
        },
        connection: null,
        runner: null,
        axes: null,
        stepsPerMillimeter: 640,
        maxFeedrate: 2000,
        maxAcceleration: 100,
        clockFrequency: 200000,
        feedRate: 0,
        currentState: null,
        connect: function () {
            var _this = this;
            this.get('connection').bind()
                .then(function () {
                    return _this.askForConfiguration();
                })
                .then(function () {
                    _this.askForPosition();
                    _this.askForState();
                });
        },
        askForConfiguration: function () {
            var _this = this;
            return _this.get('connection')
                .controlTransfer({request: CONTROL_COMMANDS.REQUEST_PARAMETERS, length: 16 })
                .then(function (data) {
                    console.log('received configuration');
                    var params = new Int32Array(data);
                    _this.set('stepsPerMillimeter', params[0]);
                    _this.set('maxFeedrate', params[1]);
                    _this.set('maxAcceleration', params[2]);
                    _this.set('clockFrequency', params[3]);
                });
        },
        askForPosition: function () {
            var _this = this;
            var positionTransfer = {request: CONTROL_COMMANDS.REQUEST_POSITION, length: 16};
            return _this.get('connection').controlTransfer(positionTransfer).then(function (data) {
                _this.decodeAxesPosition(data);
                Ember.run.later(_this, _this.askForPosition, 500);
            }, function () {
                console.error('error getting position', arguments);
                return _this.get('connection').reset().then(function () {
                    return _this.connect();
                });
            });
        },
        askForState: function () {
            var _this = this;
            var transfer = {request: CONTROL_COMMANDS.REQUEST_STATE, length: 8};
            return this.get('connection').controlTransfer(transfer).then(
                function (data) {
                    _this.decodeState(data);
                    Ember.run.later(_this, _this.askForState, 200);
                }, function () {
                    console.error('error getting state', arguments);
                    return _this.get('connection').reset().then(function () {
                        return _this.connect();
                    });
                });
        },
        setAxisValue: function (axis, valueInmm) {
            var values = {X: 0, Y: 0, Z: 0};
            values[axis] = valueInmm * this.get('stepsPerMillimeter');
            var encodedAxis = parseInt({X: '001', Y: '010', Z: '100'}[axis], 2);
            var data = new Int32Array([values.X, values.Y , values.Z]).buffer;
            return this.get('connection').controlTransfer({direction: 'out', request: CONTROL_COMMANDS.REQUEST_DEFINE_AXIS_POSITION, value: encodedAxis, data: data});
        },
        setManualMode: function () {
            this.get('connection').controlTransfer({direction: 'out', request: CONTROL_COMMANDS.REQUEST_TOGGLE_MANUAL_STATE, data: new ArrayBuffer(0)});
        },
        decodeAxesPosition: function (data) {
            var buffer = new Int32Array(data);
            this.get('axes')[0].set('position', buffer[0] / this.get('stepsPerMillimeter'));
            this.get('axes')[1].set('position', buffer[1] / this.get('stepsPerMillimeter'));
            this.get('axes')[2].set('position', buffer[2] / this.get('stepsPerMillimeter'));
            var feedrate = buffer[3] == 0 ? 0 : 60 * this.get('clockFrequency') / this.get('stepsPerMillimeter') / buffer[3];
            this.set('feedRate', feedrate);
            $('#webView')[0].contentWindow.postMessage({type: 'toolPosition', position: this.getParameters().position}, '*');
        },
        decodeState: function (data) {
            var state = new DataView(data).getUint32(0, true);
            this.set('currentState', state);
        },
        getParameters: function () {
            var keys = ['stepsPerMillimeter', 'maxFeedrate', 'maxAcceleration', 'clockFrequency'];
            var res = {};
            for (var i = 0; i < keys.length; i++)
                res[keys[i]] = this.get(keys[i]);
            var axes = this.get('axes');
            res.position = {x: axes[0].get('position'),
                y: axes[1].get('position'),
                z: axes[2].get('position')};
            return res;
        },
        sendGcode: function (code) {
            this.get('runner').executeProgram({type: 'gcode', program: code, parameters: this.getParameters()});
        },
        abort: function () {
            var _this = this;
            this.get('runner').stop()
                .then(function () {
                    return _this.get('connection').reset();
                })
                .then(function () {
                    return _this.connect();
                });
        },
        transmitProgram: function () {
            var deferred = rsvp.defer();
            $('#webView')[0].contentWindow.postMessage({type: 'gimme program', parameters: this.getParameters()}, '*',
                [this.get('runner').getCodeChannel(deferred)]);
            return deferred.promise;
        }
    });
    CNCMachine.STATES = STATES;
    return CNCMachine;
});