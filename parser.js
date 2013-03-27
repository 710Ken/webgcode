machinePos = {};
path = [];

REAL_NUMBER_REGEX = "[+-]?[0-9]+(?:[.][0-9]*)?";
RADIUS_DETECTOR = new RegExp('R(' + REAL_NUMBER_REGEX + ')');
AXES = ['x', 'y', 'z'];
AXES_DETECTORS = {};
$.each(AXES, function (_, axis) {
    //returns only the rightmost when it appears multiple times on the same line.
    AXES_DETECTORS[axis] = new RegExp(axis.toUpperCase() + '(' + REAL_NUMBER_REGEX + ')');
});

function detectAxisMove(s) {
    var result = {};
    $.each(AXES, function (_, axis) {
        var parsed = AXES_DETECTORS[axis].exec(s);
        if (parsed)
            result[axis] = parseFloat(parsed[1]);
    });
    return result;
}

function cloneObject(old) {
    return $.extend({}, old)
}

function move(parsedMove) {
    var newPos = $.extend(cloneObject(machinePos), parsedMove);
    var hadMovement = false;
    $.each(AXES, function (_, axis) {
        hadMovement = hadMovement || newPos[axis] != machinePos[axis];
    });
    if (hadMovement) {
        path.push(cloneObject(newPos));
        machinePos = newPos;
    }
}

function parseArc(line) {
    var targetPos = $.extend(cloneObject(machinePos), detectAxisMove(line));

    var radius = parseFloat(RADIUS_DETECTOR.exec(line)[1]);
    // I can't do maths, found there : https://github.com/grbl/grbl/blob/master/gcode.c#L430
    var x = targetPos.x - machinePos.x;
    var y = targetPos.y - machinePos.y;
    var h_x2_div_d = 4 * radius * radius - x * x - y * y;
    h_x2_div_d = -Math.sqrt(h_x2_div_d) / Math.sqrt(x * x + y * y);

    var toCenterX = 0.5 * (x - (y * h_x2_div_d));
    var toCenterY = 0.5 * (y + (x * h_x2_div_d));
    var centerX = machinePos.x + toCenterX;
    var centerY = machinePos.y + toCenterY;
    var targetCenterX = targetPos.x - centerX;
    var targetCenterY = targetPos.y - centerY;

    var angularDiff = Math.atan2(-toCenterX * targetCenterY + toCenterY * targetCenterX,
        -toCenterX * targetCenterX - toCenterY * targetCenterY);
    var angularStart = Math.atan2(-toCenterY, -toCenterX);
    for (var i = 0; i <= 10; i++) {
        var angle = angularStart + angularDiff * i / 10;
        var px = centerX + radius * Math.cos(angle);
        var py = centerY + radius * Math.sin(angle);
        move({x:px, y:py, z:machinePos.z});
    }
}

function evaluateCode() {
    path = [];
    machinePos = {};
    $.each(AXES, function (_, axis) {
        machinePos[axis] = 0;
    });
    path.push(machinePos);
    var text = $('#codebox').val();
    var arrayOfLines = text.match(/[^\r\n]+/g);
    $.each(arrayOfLines, function (lineNo, line) {
        //drop spaces, go uppercase
        line = line.replace(/[\t ]+/g, '').toUpperCase();
        //drop line number
        line = line.replace(/^N[0-9]+/, '');
        var gCode = /^G([0-9.]+)(.*)/.exec(line);
        if (gCode) {
            var codeNum = parseFloat(gCode[1]);
            if (codeNum == 0 || codeNum == 1)
                move(detectAxisMove(gCode[2]));
            else if (codeNum == 2 || codeNum == 3)
                parseArc(gCode[2]);
        } else {
            var parsedMove = detectAxisMove(line);
            if (parsedMove)
                move(parsedMove);
            else
                console.log('Did not understand the line, skipping');
        }

    });
    var indexes = [];
    var points = [];
    for (i = 0; i < path.length; i++) {
        indexes.push(i);
        var p = path[i];
        points.push([p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)].join(' '))
    }
    indexes.push(-1);
    var lineset = $('<IndexedLineSet></IndexedLineSet>');
    var coordinates = $('<Coordinate></Coordinate>');
    lineset.attr('coordIndex', indexes.join(' '));
    coordinates.attr('point', points.join(', '));
    lineset.append(coordinates);
    $('#toolpath').remove();
    $('#scene').append($('<Shape id="toolpath"></Shape>').append(lineset));
}
