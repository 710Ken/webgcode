'use strict';
define(['Ember', 'cnc/svgImporter', 'cnc/gerberImporter', 'cnc/excellonImporter', 'cnc/ui/threeDView', 'THREE', 'cnc/util', 'cnc/cam/3D/toolProfile'],
    function (Ember, svgImporter, gerberImporter, excellonImporter, TreeDView, THREE, util, toolProfile) {
        var ApplicationView = Ember.View.extend({
            classNames: ['rootview']
        });
        var JobView = Ember.View.extend({
            classNames: ['job'],
            classNameBindings: ['isBusy'],
            didInsertElement: function () {
                var _this = this;
                this.$('#deleteBlock').hover(function () {
                    $(this).data('hovering', true);
                    _this.displayFakeDelete(false);
                }, function () {
                    $(this).data('hovering', false);
                    if (_this.get('controller.deleteSlider') == 0)
                        _this.displayFakeDelete(true);
                });
                this.$('#deleteSlider').mouseup(function () {
                    if (_this.get('controller.deleteSlider') == 1) {
                        _this.get('controller').send('delete');
                        _this.displayFakeDelete(true);
                    }
                    _this.set('controller.deleteSlider', 0);
                });
            },
            dragEnter: function (event) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
            },
            dragOver: function (event) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
            },
            drop: function (event) {
                var _this = this;

                function loadStl(file) {
                    var reader = new FileReader();
                    reader.onload = function (e) {
                        _this.get('controller').addSTL(e.target.result, file.name);
                    };
                    reader.readAsBinaryString(file);
                }

                function loadSvg(file) {
                    var reader = new FileReader();
                    reader.onload = function (e) {
                        var res = svgImporter(e.target.result);
                        _this.get('controller').addShapes(res, file.name);
                    };
                    reader.readAsText(file);
                }

                function loadGerber(file) {
                    _this.set('isBusy', true);
                    var reader = new FileReader();
                    reader.onload = function (e) {
                        try {
                            var res = gerberImporter(e.target.result);
                            _this.get('controller').addShapes([res], file.name);
                        } catch (error) {
                            if (error.message == 'unrecognized file') {
                                console.log('unrecognized gerber, trying excellon');
                                var res2 = excellonImporter(e.target.result);
                                var keys = Object.keys(res2.holes);
                                var shapes = [];
                                for (var i = 0; i < keys.length; i++) {
                                    var k = keys[i];
                                    var diameter = res2.defs[k];
                                    var positions = res2.holes[k];
                                    var right = new util.Point(diameter / 1.8, 0);
                                    var top = new util.Point(0, diameter / 1.8);
                                    for (var j = 0; j < positions.length; j++) {
                                        var pos = positions[j];
                                        shapes.push('M' + pos.sub(right).svg() + 'L' + pos.add(right).svg());
                                        shapes.push('M' + pos.sub(top).svg() + 'L' + pos.add(top).svg());
                                    }
                                }
                                _this.get('controller').addShapes([shapes], file.name, {drillData: JSON.stringify(res2)});
                            }
                        } finally {
                            _this.set('isBusy', false);
                        }
                    };
                    reader.readAsText(file);
                }

                event.preventDefault();
                event.stopPropagation();
                var files = event.dataTransfer.files;
                for (var i = 0; i < files.length; i++) {
                    var file = files[i];
                    if (file.type.indexOf('svg') != -1 || file.name.match(/\.svg/i))
                        loadSvg(file);
                    else if (file.type.indexOf('stl') != -1 || file.name.match(/\.stl/i))
                        loadStl(file);
                    else loadGerber(file);
                }
            },
            displayFakeDelete: function (displayFake) {
                this.$('#fakeDelete').toggle(displayFake);
                this.$('#realDelete').toggle(!displayFake);
            },
            observeDeleteSlider: function () {
                var val = this.get('controller.deleteSlider');
                if (this.$()) {
                    this.$('#deleteBlock').css('background-color', 'rgba(255, 0, 0, ' + val + ')');
                    if (val == 1) {
                        $('#slideToDelete').hide();
                        $('#releaseToDelete').show();
                    } else {
                        $('#slideToDelete').show();
                        $('#releaseToDelete').hide();
                    }
                    if (val == 0 && !this.$('#deleteBlock').data('hovering'))
                        this.displayFakeDelete(true);
                }
            }.observes('controller.deleteSlider')
        });

        var LoginView = Ember.View.extend({
            tagName: 'webview',
            classNames: ['loginFrame'],
            attributeBindings: ['src', ''],
            didInsertElement: function () {
                this.$().on('loadstop', Ember.run.bind(this, this.loadstop));
            },
            src: function () {
                return 'https://auth.firebase.com/v2/popping-fire-1042/auth/' + this.get('controller.model')
                    + '?v=js-0.0.0&transport=json&suppress_status_codes=true'
            }.property('controller.model'),
            loadstop: function () {
                var _this = this;
                var service = _this.get('controller.model');
                var url = this.$().attr('src').split('?')[0];
                if (url.indexOf('/auth/' + service + '/callback') != -1) {
                    this.$()[0].executeScript({code: 'document.getElementsByTagName("pre")[0].innerHTML;'}, function (res) {
                        var authData = JSON.parse(res[0]);
                        _this.get('controller').send('loginWithToken', authData);
                    });
                }
            }
        });

        function collectVertices(toolpath, defaultZ) {
            var res = [];
            toolpath.forEachPoint(function (x, y, z, _) {
                res.push(x, y, z);
            }, defaultZ);
            return new Float32Array(res);
        }

        var ShapeWrapper = Ember.Object.extend({
            willDestroy: function () {
                this._super();
                this.get('outlineDisplay').remove();
            },
            copyShapeToOutline: function () {
                var outlineDisplay = this.get('outlineDisplay');
                var shape = this.get('shape');
                outlineDisplay.clear();
                outlineDisplay.addPolyLines(shape.get('polyline'));
                var meshGeometry = shape.get('meshGeometry');
                if (meshGeometry)
                    outlineDisplay.addMesh(meshGeometry);
                outlineDisplay.setVisibility(this.get('shape.visible'));
            }.observes('shape.polyline', 'shape.meshGeometry').on('init'),
            visibleChanged: function () {
                this.get('outlineDisplay').setVisibility(this.get('shape.visible'));
            }.observes('shape.visible')
        });

        var ThreeDView = Ember.View.extend({
            classNames: ['ThreeDView'],
            didInsertElement: function () {
                var threeDView = new TreeDView.ThreeDView(this.$());
                threeDView.normalToolpathNode.lineMaterial = new THREE.LineBasicMaterial({
                    linewidth: 1.2,
                    color: 0x6688aa
                });
                threeDView.rapidMaterial = new THREE.LineBasicMaterial({
                    linewidth: 1.2,
                    color: 0xdd4c2f,
                    depthWrite: false
                });
                threeDView.outlineMaterial = new THREE.LineBasicMaterial({linewidth: 1.2, color: 0x000000});
                threeDView.highlightMaterial = new THREE.LineBasicMaterial({
                    depthWrite: false, overdraw: true, linewidth: 6,
                    color: 0xdd4c2f, opacity: 0.5, transparent: true
                });
                this.set('nativeComponent', threeDView);
                this.set('travelDisplay', threeDView.createDrawingNode(threeDView.rapidMaterial, new THREE.MeshLambertMaterial({
                    color: 0xFEEFFE,
                    shading: THREE.SmoothShading
                })));
                this.set('outlinesDisplay', threeDView.createDrawingNode(threeDView.outlineMaterial, new THREE.MeshLambertMaterial({
                    color: 0xFEEFFE,
                    shading: THREE.SmoothShading
                })));
                this.set('highlightDisplay', threeDView.createOverlayNode(threeDView.highlightMaterial, new THREE.MeshLambertMaterial({
                    color: 0xdd4c2f, opacity: 0.5,
                    shading: THREE.SmoothShading
                })));

                this.synchronizeCurrentOperation();
                this.synchronizeJob();
                var outlinesViews = [];

                function wrapShape(shape) {
                    return ShapeWrapper.create({
                        shape: shape,
                        outlineDisplay: threeDView.createDrawingNode(threeDView.outlineMaterial, new THREE.MeshLambertMaterial({
                            color: 0xFEEFFE,
                            shading: THREE.SmoothShading
                        }))
                    });
                }

                this.get('controller.shapes.content').addArrayObserver({
                    arrayWillChange: function (observedObj, start, removeCount, addCount) {
                        for (var i = start; i < start + removeCount; i++)
                            outlinesViews[i].destroy();
                        outlinesViews.replace(start, removeCount, []);
                    },
                    arrayDidChange: function (observedObj, start, removeCount, addCount) {
                        var newItems = [];
                        for (var i = start; i < start + addCount; i++)
                            newItems.push(wrapShape(observedObj[i]));
                        outlinesViews.replace(start, 0, newItems);
                    }
                });
                this.get('controller.shapes').forEach(function (shape) {
                    outlinesViews.push(wrapShape(shape));
                });
                this.synchronizeCurrentShape();
            },
            synchronizeCurrentOperation: function () {
                var threeDView = this.get('nativeComponent');
                threeDView.clearToolpath();
                var operation = this.get('controller.currentOperation');
                if (operation) {
                    var toolpath2 = operation.get('toolpath');
                    if (toolpath2)
                        toolpath2.forEach(function (toolpath) {
                            threeDView.normalToolpathNode.addCollated(collectVertices(toolpath, operation.get('contourZ')));
                        });
                }
                threeDView.reRender();
            }.observes('controller.currentOperation', 'controller.currentOperation.toolpath.@each', 'controller.currentOperation.toolpath'),
            synchronizeCurrentShape: function () {
                var highlightDisplay = this.get('highlightDisplay');
                highlightDisplay.clear();
                var shape = this.get('controller.currentShape');
                if (shape) {
                    var polyline = shape.get('polyline');
                    if (polyline)
                        highlightDisplay.addPolyLines(polyline);
                    var meshGeometry = shape.get('meshGeometry');
                    if (meshGeometry)
                        highlightDisplay.addMesh(meshGeometry.clone());
                }
                this.get('nativeComponent').reRender();
            }.observes('controller.currentShape', 'controller.currentShape.polyline'),
            synchronizeJob: function () {
                var threeDView = this.get('nativeComponent');
                var travelDisplay = this.get('travelDisplay');
                travelDisplay.clear();
                if (this.get('controller.showTravel')) {
                    var travelMoves = this.get('controller.transitionTravels');
                    travelDisplay.addPolyLines(travelMoves.map(function (move) {
                        return move.path;
                    }));
                }
                threeDView.reRender();
            }.observes('controller.transitionTravels', 'controller.showTravel'),
            synchronizeToolPosition: function () {
                var threeDView = this.get('nativeComponent');
                var position = this.get('controller.toolPosition');
                threeDView.setToolVisibility(true);
                threeDView.setToolPosition(position.x, position.y, position.z);
            }.observes('controller.toolPosition')
        });

        var ToolView = Ember.View.extend({
            tagName: 'canvas',
            didInsertElement: function () {
                var ctx = this.get('element').getContext('2d');
                this.set('canvas', ctx);
                this.updateImage();
            },
            updateImage: function () {
                var ctx = this.get('canvas');
                if (!ctx)
                    return;
                var leaveStock = this.get('controller.3d_leaveStock');
                var radius = this.get('controller.job.toolDiameter') / 2 + leaveStock;
                var profile = toolProfile.createTool(this.get('controller.tool'), 30, 1, leaveStock);
                var max = -Infinity;
                var min = Infinity;
                for (var i = 0; i < profile.length; i++) {
                    var point = profile[i];
                    if (isFinite(point) && !isNaN(point)) {
                        max = Math.max(point, max);
                        min = Math.min(point, min);
                    }
                }
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                var middleX = ctx.canvas.width / 2;
                var factor = ctx.canvas.height / 2 / (max - min);
                ctx.strokeStyle = "blue";
                ctx.save();
                ctx.setLineDash([8, 3]);
                ctx.beginPath();
                var startX = middleX - radius * factor;
                for (i = 0; i < profile.length; i++) {
                    point = profile[profile.length - i - 1];
                    ctx.lineTo(startX + (i / profile.length * radius) * factor, Math.max(ctx.canvas.height - (point - min) * factor, 0));
                }
                for (i = 0; i < profile.length; i++) {
                    point = profile[i];
                    ctx.lineTo(startX + (1 + i / profile.length) * radius * factor, Math.max(ctx.canvas.height - (point - min) * factor, 0));
                }
                ctx.stroke();
                ctx.restore();
                profile = toolProfile.createTool(this.get('controller.tool'), 30, 1, 0);
                radius = this.get('controller.job.toolDiameter') / 2;
                ctx.strokeStyle = "black";
                ctx.beginPath();
                startX = middleX - radius * factor;
                for (i = 0; i < profile.length; i++) {
                    point = profile[profile.length - i - 1];
                    ctx.lineTo(startX + (i / profile.length * radius) * factor, Math.max(ctx.canvas.height - (point - min) * factor, 0));
                }
                for (i = 0; i < profile.length; i++) {
                    point = profile[i];
                    ctx.lineTo(startX + (1 + i / profile.length) * radius * factor, Math.max(ctx.canvas.height - (point - min) * factor, 0));
                }
                ctx.stroke();
            }.observes('controller.model.tool', 'controller.3d_leaveStock')
        });

        return {
            ThreeDView: ThreeDView,
            LoginView: LoginView,
            ApplicationView: ApplicationView,
            JobView: JobView,
            ToolView: ToolView
        };
    });