"use strict";

define(['cnc/simulation', 'cnc/parser', 'require'], function (simulation, parser, require) {
    var currentSpeedTag = null;
    var simulatedPath = [];
    var simulationFragments = [];

    function closeFragment() {
        if (simulatedPath.length) {
            simulationFragments.push({vertices: new Float32Array(simulatedPath), speedTag: currentSpeedTag});
            //repeat the last point as ne new first point, because we're breaking the polyline
            simulatedPath = simulatedPath.slice(-3);
        }
    }

    function accumulatePoint(point, segment) {
        if (currentSpeedTag != segment.speedTag) {
            closeFragment();
            currentSpeedTag = segment.speedTag;
        }
        simulatedPath.push(point.x, point.y, point.z);
    }

    function simulateGCode(code) {
        var errors = [];
        var toolPath = parser.evaluate(code, null, null, null, errors);
        var map = [];
        accumulatePoint(toolPath[0].from, toolPath[0]);
        for (var i = 0; i < toolPath.length; i++) {
            var segment = toolPath[i];
            if (segment.type == 'line') {
                var array = [segment.from, segment.to];
                array.speedTag = segment.speedTag;
                map[segment.lineNo] = array;
                accumulatePoint(segment.to, segment);
            } else {
                var tolerance = 0.001;
                var steps = Math.PI / Math.acos(1 - tolerance / segment.radius) * Math.abs(segment.angularDistance) / (Math.PI * 2);
                var points = [];
                for (var j = 0; j <= steps; j++) {
                    var point = simulation.COMPONENT_TYPES['arc'].pointAtRatio(segment, j / steps, true);
                    points.push(point);
                    accumulatePoint(point, segment);
                }
                map[segment.lineNo] = points;
            }
        }

        var totalTime = 0;
        var xmin = +Infinity, ymin = +Infinity, zmin = +Infinity;
        var xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;


        function pushPoint(x, y, z, t) {
            totalTime = Math.max(t, totalTime);
            xmin = Math.min(x, xmin);
            ymin = Math.min(y, ymin);
            zmin = Math.min(z, zmin);
            xmax = Math.max(x, xmax);
            ymax = Math.max(y, ymax);
            zmax = Math.max(z, zmax);
        }

        simulation.simulate2(toolPath, pushPoint);
        closeFragment();
        return {totalTime: totalTime, simulatedPath: simulationFragments,
            min: {x: xmin, y: ymin, z: zmin}, max: {x: xmax, y: ymax, z: zmax},
            errors: errors, lineSegmentMap: map};
    }

    function parseImmediately(code, resultHandler) {
        resultHandler(simulateGCode(code));
    }

    function parseInWorker(code, resultHandler) {
        var worker = new Worker(require.toUrl('worker.js'));
        worker.onerror = function (error) {
            console.log('worker error', error);
            console.log('trying again without worker');
            parseImmediately(code, resultHandler);
        };
        window.myWorker = worker;
        worker.onmessage = function (event) {
            worker.onerror = function (error) {
                console.log('worker error', error);
            };
            resultHandler(event.data);
            window.myWorker = null;
        };
        worker.postMessage({
            operation: 'simulateGCode',
            code: code
        });
    }

    function tryToParseInWorker(code, resultHandler) {
        try {
            parseInWorker(code, resultHandler);
        } catch (error) {
            console.log('worker error', error);
            console.log('trying again without worker');
            parseImmediately(code, resultHandler);
        }
    }

    return {simulateGCode: simulateGCode,
        parseImmediately: parseImmediately,
        parseInWorker: parseInWorker,
        tryToParseInWorker: tryToParseInWorker};
});