"use strict";
var $ = {
    each: function (array, func) {
        for (var i = 0; i < array.length; i++)
            func(i, array[i]);
    },
    extend: function () {
        /** stolen from JQUERY **/
        var src, copy, name, options,
            target = arguments[0] || {},
            length = arguments.length;
        for (var i = 0; i < length; i++)
            if ((options = arguments[ i ]) != null)
                for (name in options) {
                    src = target[name];
                    copy = options[name];
                    if (target === copy)
                        continue;
                    if (copy !== undefined)
                        target[name] = copy;
                }
        return target;
        /** END stolen from JQUERY **/
    }
};

importScripts('libs/require.js');
var work = [];
self.onmessage = function (event) {
    work.push(event);
};

require(['cnc/parser', 'cnc/simulation'], function (parser, simulation) {
    function handleFragment(program) {
        var programLength = program.length * 3;
        var formattedData = new ArrayBuffer(programLength + 4);
        new DataView(formattedData).setUint32(0, programLength, true);
        var view = new DataView(formattedData, 4);

        function bin(axis) {
            var xs = axis ? '1' : '0';
            var xd = axis >= 0 ? '1' : '0';
            return '' + xd + xs;
        }

        for (var i = 0; i < program.length; i++) {
            var point = program[i];
            view.setUint16(i * 3, point.time, true);
            var word = '00' + bin(point.dz) + bin(point.dy) + bin(point.dx);
            view.setUint8(i * 3 + 2, parseInt(word, 2), true);
        }
        self.postMessage(formattedData, [formattedData]);
    }

    function handleMessage(event) {
        event.ports[0].onmessage = function (event) {
            var params = event.data.parameters;
            var toolPath = event.data.type == 'gcode' ? parser.evaluate(event.data.program, params.maxFeedrate, params.maxFeedrate, params.position) : event.data.toolPath;
            var program = [];
            simulation.planProgram(toolPath, params.maxAcceleration, 1 / params.stepsPerMillimeter, params.clockFrequency, function stepCollector(point) {
                program.push(point);
                if (program.length >= 30000) {
                    handleFragment(program);
                    program = [];
                }
            });
            handleFragment(program);
            self.postMessage(null);
        };
    }

    self.onmessage = handleMessage;
    for (var i = 0; i < work.length; i++) {
        handleMessage(work[i])
    }

});