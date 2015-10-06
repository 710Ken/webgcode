"use strict";
define(['RSVP', 'cnc/cam/cam', 'cnc/cam/toolpath', 'cnc/cam/pocket', 'cnc/util', 'clipper', 'libs/earcut.min'],
    function (RSVP, cam, tp, pocket, util, clipper, earcut) {
        function attr(type, options) {
            return {type: type, options: options};
        }

        function pointComparison(p1, p2) {
            return util.morton(p1.x, p1.y) - util.morton(p2.x, p2.y);
        }

        function contour(params, machine) {
            var result = machine.contourAndMissedArea(params.outline.clipperPolyline, parseFloat(params.job.toolDiameter) / 2,
                parseFloat(params.contour_leaveStock), params.contour_inside);
            return {
                contours: machine.fromClipper(result.toolpath, true, machine.contourAreaPositive(params.contour_inside, params.contour_climbMilling)),
                missedArea: [machine.fromClipper(result.missedArea).map(function (poly) {
                    return poly.asGeneralToolpath(0).path;
                })]
            };
        }

        function computeLeaveStockContourPolygon(params) {
            var poly = params.outline.clipperPolyline;
            var machine = new cam.Machine(null);
            if (!poly)
                return null;
            var offset = machine.offsetPolygon(poly, (params.contour_inside ? -1 : 1) * parseFloat(params.contour_leaveStock));
            var result = params.contour_inside
                ? machine.polyOp(poly, offset, clipper.ClipType.ctDifference)
                : machine.polyOp(offset, poly, clipper.ClipType.ctDifference);

            function flattenClipperHierarchy(polytree, result) {
                if (result == null)
                    result = [];
                var outerStack = polytree.Childs();
                for (var j = 0; j < outerStack.length; j++) {
                    var outerNode = outerStack[j];
                    var holes = outerNode.Childs();
                    var islands = [];
                    for (var i = 0; i < holes.length; i++) {
                        flattenClipperHierarchy(holes[i], result);
                        islands.push(holes[i].Contour());
                    }
                    result.push({contour: outerNode.Contour(), holes: islands});
                }
                return result;
            }

            function clipperPolygonToThreeJS(polygon, scale) {
                var polytree = cam.polyOp(polygon, [], clipper.ClipType.ctUnion, true);
                var polygons = flattenClipperHierarchy(polytree);
                var result = [];
                for (var i = 0; i < polygons.length; i++) {
                    var poly = polygons[i];
                    var currentPositions = [];
                    var currentHoleIndices = [];
                    for (var j = 0; j < poly.contour.length; j++)
                        currentPositions.push(poly.contour[j].X / scale, poly.contour[j].Y / scale, 0);
                    for (j = 0; j < poly.holes.length; j++) {
                        currentHoleIndices.push(currentPositions.length / 3);
                        for (var k = 0; k < poly.holes[j].length; k++)
                            currentPositions.push(poly.holes[j][k].X / scale, poly.holes[j][k].Y / scale, 0);
                    }
                    result.push({
                        positions: new Float32Array(currentPositions),
                        indices: new Uint16Array(earcut(currentPositions, currentHoleIndices, 3))
                    });
                }
                return result;
            }

            return clipperPolygonToThreeJS(result, machine.clipperScale);
        }

        return {
            'SimpleEngravingOperation': {
                label: 'Simple Engraving',
                specialTemplate: 'simpleEngraving',
                properties: {
                    bottom_Z: attr('number', {defaultValue: -5})
                },
                computeToolpath: function (op) {
                    return new RSVP.Promise(function (resolve, reject) {
                        var z = op.bottom_Z;
                        var safetyZ = op.job.safetyZ;
                        var polygons = op.outline.clipperPolyline;
                        var toolpath = [];
                        var machine = new cam.Machine(null);
                        for (var i = 0; i < polygons.length; i++)
                            if (polygons[i].length) {
                                var path = new tp.GeneralPolylineToolpath();
                                toolpath.push(path);
                                path.pushPointXYZ(polygons[i][0].x / machine.clipperScale, polygons[i][0].y / machine.clipperScale, safetyZ);
                                for (var j = 0; j < polygons[i].length; j++)
                                    path.pushPointXYZ(polygons[i][j].x / machine.clipperScale, polygons[i][j].y / machine.clipperScale, z);
                            }
                        toolpath.sort(function (path1, path2) {
                            return pointComparison(path1.getStartPoint(), path2.getStartPoint());
                        });
                        resolve({toolpath: toolpath});
                    });
                },
                computeLeaveStockPolygon: function (op) {
                    return [];
                }
            },
            'SimpleContourOperation': {
                label: 'Simple Contour',
                specialTemplate: 'simpleContour',
                properties: {
                    bottom_Z: attr('number', {defaultValue: -5}),
                    contour_inside: attr('boolean', {defaultValue: true}),
                    contour_leaveStock: attr('number', {defaultValue: 0}),
                    contour_climbMilling: attr('boolean', {defaultValue: false})
                },
                computeToolpath: function (params) {
                    return new RSVP.Promise(function (resolve, reject) {
                        var machine = new cam.Machine(null);
                        machine.setParams(params.bottom_Z, 10, 100);
                        var result = contour(params, machine);
                        resolve({
                            missedArea: result.missedArea,
                            toolpath: result.contours.map(function (path) {
                                var startPoint = path.getStartPoint();
                                var generalPath = path.asGeneralToolpath(params.bottom_Z);
                                // plunge from safety plane
                                generalPath.pushPointInFront(startPoint.x, startPoint.y, params.job.safetyZ);
                                //close the loop
                                generalPath.pushPointXYZ(startPoint.x, startPoint.y, params.bottom_Z);
                                return generalPath;
                            })
                        });
                    });
                },
                computeLeaveStockPolygon: computeLeaveStockContourPolygon
            },
            'RampingContourOperation': {
                label: 'Ramping Contour',
                specialTemplate: 'rampingContour',
                properties: {
                    top_Z: attr('number', {defaultValue: 0}),
                    bottom_Z: attr('number', {defaultValue: -5}),
                    ramping_turns: attr('number', {defaultValue: 5}),
                    contour_inside: attr('boolean', {defaultValue: true}),
                    contour_leaveStock: attr('number', {defaultValue: 0}),
                    contour_climbMilling: attr('boolean', {defaultValue: false})
                },
                computeToolpath: function (op) {
                    return new RSVP.Promise(function (resolve, reject) {
                        var machine = new cam.Machine(null);
                        machine.setParams(op.top_Z, 10, 100);
                        var result = contour(op, machine);
                        var toolpath = machine.rampToolPathArray(result.contours, op.top_Z, op.bottom_Z, op.ramping_turns);
                        toolpath.forEach(function (path) {
                            var startPoint = path.getStartPoint();
                            path.pushPointInFront(startPoint.x, startPoint.y, op.job.safetyZ);
                        });
                        resolve({missedArea: result.missedArea, toolpath: toolpath});
                    });
                },
                computeLeaveStockPolygon: computeLeaveStockContourPolygon
            },
            'PocketOperation': {
                label: 'Pocket',
                specialTemplate: 'operationPocket',
                properties: {
                    bottom_Z: attr('number', {defaultValue: -5}),
                    pocket_engagement: attr('number', {defaultValue: 50}),
                    pocket_leaveStock: attr('number', {defaultValue: 0.1}),
                    pocket_ramping_entry: attr('boolean', {defaultValue: true}),
                    ramping_turns: attr('number', {defaultValue: 2}),
                    top_Z: attr('number', {defaultValue: 0})
                },
                computeToolpath: function (op) {
                    return new RSVP.Promise(function (resolve, reject) {
                        var clipperPolygon = op.outline.clipperPolyline;
                        var machine = new cam.Machine(null);
                        var leaveStock = op.pocket_leaveStock;
                        if (leaveStock)
                            clipperPolygon = machine.offsetPolygon(clipperPolygon, -leaveStock);
                        var scaledToolRadius = parseFloat(op.job.toolDiameter) / 2 * cam.CLIPPER_SCALE;
                        var result = pocket.createPocket(clipperPolygon, scaledToolRadius, op.pocket_engagement / 100, self['Worker'] == undefined);
                        var toolpath = [];
                        var missedArea = [];
                        var promises = result.workArray.map(function (unit) {
                            return RSVP.hash({result: unit.promise, undercut: unit.undercutPromise});
                        });
                        resolve(RSVP.all(promises).then(function (workResult) {
                            workResult.forEach(function (result) {
                                result.result.forEach(function (pocketResult, index) {
                                    var path = [];
                                    var entries = [];
                                    var separatedContours = [];

                                    function collect(layer) {
                                        for (var i = 0; i < layer.children.length; i++)
                                            collect(layer.children[i]);
                                        if (layer.spiraledToolPath) {
                                            path = path.concat(machine.fromClipper([layer.spiraledToolPath.path]));
                                        } else {
                                            //split the side paths by index
                                            var contours = machine.fromClipper(layer.contour);
                                            for (var j = 0; j < contours.length; j++) {
                                                if (!separatedContours[j])
                                                    separatedContours[j] = [];
                                                separatedContours[j].push(contours[j]);
                                            }
                                        }
                                        if (layer.spiraledToolPath)
                                            entries.push(machine.fromClipper([layer.entryPath])[0]);
                                    }

                                    collect(pocketResult);
                                    if (op.pocket_ramping_entry)
                                        path = machine.rampToolPathArray(entries, op.top_Z, op.bottom_Z, op.ramping_turns).concat(path);
                                    //make a spiral with each side, now that they are separated.
                                    for (var i = 0; i < separatedContours.length; i++) {
                                        var ct = new tp.ConstantZPolygonToolpath();
                                        for (var j = 0; j < separatedContours[i].length; j++)
                                            ct.path = ct.path.concat(separatedContours[i][j].path);
                                        path.push(ct);
                                    }
                                    path.forEach(function (path) {
                                        var startPoint = path.getStartPoint();
                                        var generalPath = path.asGeneralToolpath(op.bottom_Z);
                                        if (index == 0)
                                        // plunge from safety plane
                                            generalPath.pushPointInFront(startPoint.x, startPoint.y, op.job.safetyZ);
                                        toolpath.push(generalPath);
                                    });
                                });
                                missedArea.push(result.undercut);
                            });
                            return {toolpath: toolpath, missedArea: missedArea};
                        }));
                    });
                },
                computeLeaveStockPolygon: computeLeaveStockContourPolygon
            },
            '3DlinearOperation': {
                label: '3D linear milling',
                specialTemplate: '3DMilling',
                properties: {
                    '3d_leaveStock': attr('number', {defaultValue: 0.5}),
                    top_Z: attr('number', {defaultValue: 0}),
                    'bottom_Z': attr('number', {defaultValue: -1000}),
                    '3d_toolType': attr('string', {defaultValue: 'cylinder'}),
                    '3d_vToolAngle': attr('number', {defaultValue: 10}),
                    '3d_vToolTipDiameter': attr('number', {defaultValue: 0.1}),
                    '3d_diametralEngagement': attr('number', {defaultValue: 40}),
                    '3d_pathOrientation': attr('string', {defaultValue: 0}),
                    '3d_startPercent': attr('number', {defaultValue: 0}),
                    '3d_stopPercent': attr('number', {defaultValue: 100}),
                    '3d_slice_Z': attr('number', {defaultValue: 5})
                },
                computeToolpath: function (op) {
                    return null;
                },
                computeLeaveStockPolygon: function (op) {
                    return [];
                }
            },
            'DrillOperation': {
                label: 'Drilling',
                specialTemplate: 'drilling',
                properties: {
                    top_Z: attr('number', {defaultValue: 0}),
                    bottom_Z: attr('number', {defaultValue: -5})
                },
                computeToolpath: function (op) {
                    return new RSVP.Promise(function (resolve, reject) {
                        var start = op.top_Z;
                        var stop = op.bottom_Z;
                        var point = op.outline.point;
                        var safetyZ = op.job.safetyZ;

                        function tpForPoint(point) {
                            var path = new tp.GeneralPolylineToolpath();
                            path.pushPointXYZ(point.x - op.job.offsetX, point.y - op.job.offsetY, safetyZ);
                            path.pushPointXYZ(point.x - op.job.offsetX, point.y - op.job.offsetY, start);
                            path.pushPointXYZ(point.x - op.job.offsetX, point.y - op.job.offsetY, stop);
                            return path;
                        }

                        if (op.outline.drillData) {
                            var result = [];
                            var xFactor = op.outline.flipped ? -1 : 1;
                            var data = JSON.parse(op.outline.drillData);
                            var keys = Object.keys(data.holes);
                            for (var i = 0; i < keys.length; i++) {
                                var points = data.holes[keys[i]];
                                for (var j = 0; j < points.length; j++)
                                    result.push(new util.Point(points[j].x * xFactor, points[j].y));
                            }

                            result.sort(pointComparison);
                            resolve({
                                toolpath: result.map(function (point) {
                                    return tpForPoint(point);
                                })
                            });
                        } else
                            resolve({toolpath: [tpForPoint(point)]});
                    });
                },
                computeLeaveStockPolygon: function (op) {
                    return [];
                }
            }
        };
    });