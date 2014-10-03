"use strict";
require(['Ember', 'RSVP', 'cnc/ui/threeDView', 'cnc/ui/twoDView', 'cnc/cam/cam', 'cnc/util', 'cnc/ui/gcodeEditor',
        'cnc/ui/jsEditor', 'cnc/gcode/gcodeSimulation', 'cnc/gcode/simulation', 'cnc/cam/toolpath', 'libs/svg-import', 'templates'],
    function (Ember, RSVP, threeD, TwoDView, cam, util, gcodeEditor, jsEditor, gcodeSimulation, simulation, tp) {
        var demoCode = $('#demoCode').text();
        var demoJSCode = $('#demoJSCode').text();

        Ember.Handlebars.helper('num', function (value) {
            return new Handlebars.SafeString(Handlebars.Utils.escapeExpression(util.formatCoord(value)));
        });

        Ember.TEMPLATES['application'] = Ember.TEMPLATES['camApp'];

        window.Simulator = Ember.Application.create({
            rootElement: '#app'
        });

        Simulator.GcodeEditorComponent = gcodeEditor.GcodeEditorComponent;
        Simulator.JsEditorComponent = jsEditor.JSEditorComponent;

        Simulator.ThreeDView = Ember.View.extend({
            classNames: ['ThreeDView'],
            didInsertElement: function () {
                var threeDView = new threeD.ThreeDView(this.$());
                this.set('nativeComponent', threeDView);
                this.set('highlightDisplay', threeDView.createOverlayNode(threeDView.highlightMaterial));
                this.highlightChanged();
                this.get('controller.simulatedPath').addArrayObserver({
                    arrayWillChange: function (observedObj, start, removeCount, addCount) {
                        if (removeCount == observedObj.length)
                            threeDView.clearView();
                    },
                    arrayDidChange: function (observedObj, start, removeCount, addCount) {
                        for (var i = 0; i < addCount; i++) {
                            var fragment = observedObj[start + i];
                            threeDView[fragment.speedTag == 'rapid' ? 'rapidToolpathNode' : 'normalToolpathNode']
                                .addCollated(fragment.vertices);
                        }
                        threeDView.reRender();
                    }
                });
            },
            simulatedPathChanged: function () {
                if (!this.get('controller.computing'))
                    this.get('nativeComponent').zoomExtent();
            }.observes('controller.computing'),
            highlightChanged: function () {
                var highlightDisplay = this.get('highlightDisplay');
                var highlight = this.get('controller.currentHighLight');
                highlightDisplay.clear();
                if (highlight)
                    highlightDisplay.addPolyLines([highlight]);
                this.get('nativeComponent').reRender();
            }.observes('controller.currentHighLight'),
            toolMoved: function () {
                var position = this.get('controller.toolPosition');
                this.get('nativeComponent').setToolVisibility(true);
                this.get('nativeComponent').setToolPosition(position.x, position.y, position.z);

            }.observes('controller.toolPosition')
        });
        Simulator.TwoDView = Ember.View.extend({
            classNames: ['TwoDView'],
            didInsertElement: function () {
                var view = TwoDView.TwoDView.create({element: this.$()});
                this.set('nativeComponent', view);
                var toolpath = view.paper.group();
                var decorations = view.paper.group();
                var _this = this;
                this.get('controller.simulatedPath').addArrayObserver({
                    arrayWillChange: function (observedObj, start, removeCount, addCount) {
                        for (var i = removeCount - 1; i >= 0; i--)
                            toolpath.get([start + i]).remove();
                    },
                    arrayDidChange: function (observedObj, start, removeCount, addCount) {
                        for (var i = 0; i < addCount; i++)
                            toolpath.add(_this.createFragment(toolpath, observedObj[start + i]), start + i);
                        view.zoomExtent();
                    }
                });
                this.get('controller.decorations').addArrayObserver({
                    arrayWillChange: function (observedObj, start, removeCount, addCount) {
                        for (var i = removeCount - 1; i >= 0; i--)
                            decorations.get([start + i]).remove();
                    },
                    arrayDidChange: function (observedObj, start, removeCount, addCount) {
                        for (var i = 0; i < addCount; i++)
                            decorations.add(_this.createDecoration(decorations, observedObj[start + i]), start + i);
                    }
                });
            },
            createDecoration: function (parent, decorationDescription) {
                var color = decorationDescription.color;
                return parent.path(decorationDescription.definition, true).attr({'vector-effect': 'non-scaling-stroke', fill: 'none', stroke: color == null ? 'yellow' : color})
            },
            createFragment: function (parent, fragment) {
                var polyline = [];
                var vertices = new Float32Array(fragment.vertices);
                for (var i = 0; i < vertices.length; i += 3)
                    polyline.push({X: vertices[i], Y: vertices[i + 1]});
                return parent.path(cam.simplifyScaleAndCreatePathDef([polyline], 1, 0.001, false))
                    .attr({class: 'toolpath ' + (fragment.speedTag == 'rapid' ? 'rapidMove' : 'normalMove')});
            },
            highlightChanged: function () {
                var highlight = this.get('controller.currentHighLight');
                var currentHighlight = this.get('highlight');
                if (currentHighlight) {
                    currentHighlight.remove();
                    currentHighlight = null;
                }
                if (highlight) {
                    currentHighlight = this.get('nativeComponent.overlay')
                        .path(cam.simplifyScaleAndCreatePathDef([highlight.map(function (point) {
                            return {X: point.x, Y: point.y};
                        })], 1, 0.001, false))
                        .attr({fill: 'none', 'stroke': '#FF00FF', 'stroke-width': 6, 'stroke-linecap': 'round'});
                }
                this.set('highlight', currentHighlight);
            }.observes('controller.currentHighLight')
        });

        Simulator.ApplicationController = Ember.ObjectController.extend({
            init: function () {
                this._super();
                var _this = this;
                window.addEventListener("message", function (event) {
                    if (event.data['type'] == 'gimme program') {
                        if (_this.get('usingGcode'))
                            event.ports[0].postMessage({type: 'gcode', program: _this.get('code'), parameters: event.data.parameters});
                        else
                            _this.getMachinePromise().then(function (machine) {
                                var toolpath = machine.dumpSimulation(event.data.parameters.position, function (fragment) {
                                });
                                event.ports[0].postMessage({type: 'toolPath', toolPath: toolpath, parameters: event.data.parameters});
                            });
                    }
                    if (event.data['type'] == 'toolPosition') {
                        var pos = event.data['position'];
                        _this.set('toolPosition', pos);
                    }
                }, false);
                this.launchSimulation();
            },
            actions: {
                simulate: function () {
                    this.launchSimulation();
                },
                loadBigSample: function () {
                    this.set('computing', true);
                    var _this = this;
                    require(['text!samples/aztec_calendar.ngc'], function (text) {
                        _this.set('code', text);
                        _this.launchSimulation();
                    });
                }
            },
            launchSimulation: function () {
                this.set('computing', true);
                this.set('lineSegmentMap', []);
                this.get('simulatedPath').clear();
                this.get('decorations').clear();
                var _this = this;
                var promise = this.get('usingGcode') ? this.simulateGCode() : this.simulateJS();
                return promise.then(function () {
                    _this.set('computing', false);
                }, function (error) {
                    console.log('error', error, error.stack);
                    _this.set('computing', false);
                });
            },
            flushFragmentFile: function () {
                this.get('simulatedPath').pushObjects(this.get('fragmentFile'));
                this.get('fragmentFile').clear();
            },
            simulateGCode: function () {
                var _this = this;
                return new RSVP.Promise(function (resolve, reject) {
                    console.time('simulation');
                    gcodeSimulation.parseInWorker(_this.get('code'), _this.get('toolPosition'),
                        Ember.run.bind(_this, resolve),
                        Ember.run.bind(_this, function (fragment) {
                            _this.get('fragmentFile').pushObject(fragment);
                            Ember.run.throttle(_this, _this.flushFragmentFile, 500);
                        }));
                }).then(function (result) {
                        _this.flushFragmentFile();
                        var errors = [];
                        for (var i = 0; i < result.errors.length; i++) {
                            var error = result.errors[i];
                            errors.push({row: error.lineNo, text: error.message, type: "error"});
                        }
                        _this.set('errors', errors);
                        _this.set('bbox', {min: result.min, max: result.max});
                        _this.set('totalTime', result.totalTime);
                        _this.set('lineSegmentMap', result.lineSegmentMap);
                    }, function (error) {
                        console.log('error', error, error.stack);
                    }).finally(function () {
                        console.timeEnd('simulation');
                    });
            },
            simulateJS: function () {
                var _this = this;
                return this.getMachinePromise().then(function (machine) {
                    var toolpath = machine.dumpSimulation(_this.get('toolPosition'), function (fragment) {
                        _this.get('fragmentFile').pushObject(fragment);
                        Ember.run.throttle(_this, _this.flushFragmentFile, 500);
                    });
                    _this.flushFragmentFile();
                    var info = simulation.collectToolpathInfo(toolpath);
                    _this.set('bbox', info);
                    _this.set('totalTime', info.totalTime);
                }, function (error) {
                    console.log('error', error, error.stack);
                });
            },
            getMachinePromise: function () {
                var _this = this;
                return new RSVP.Promise(function (resolve, reject) {
                    var requestIndex = _this.nextRequestIndex++;
                    var messageListener = window.addEventListener('message', Ember.run.bind(_this, function (event) {
                        if (event.data.requestIndex == requestIndex) {
                            switch (event.data.command) {
                                case 'eval-result':
                                    if (event.data.success) {
                                        var machine = new cam.Machine(null);
                                        var operationsData = event.data.result.operations;
                                        for (var i = 0; i < operationsData.length; ++i)
                                            machine.operations.push(tp.decodeToolPath(operationsData[i]));
                                        var outlines = event.data.result.outlines;
                                        for (i = 0; i < outlines.length; i++)
                                            this.get('decorations').pushObject(outlines[i]);
                                        $.extend(machine, event.data.result.params);
                                        resolve(machine);
                                    } else
                                        reject(event.data.error);
                                    break;
                            }
                            window.removeEventListener('message', messageListener);
                        }
                    }));
                    var decoratedCode = _this.get('jscode') + '//# sourceURL=user_code';
                    var js_sandbox = document.getElementById('js_sandbox');
                    js_sandbox.contentWindow.postMessage({
                        command: 'eval',
                        code: decoratedCode,
                        requestIndex: requestIndex
                    }, '*');
                });
            },
            usingGcode: function () {
                return this.get('selectedLanguage') == 'gcode';
            }.property('selectedLanguage'),
            currentHighLight: function () {
                return this.get('lineSegmentMap')[this.get('currentRow')];
            }.property('currentRow', 'lineSegmentMap').readOnly(),
            codeChanged: function () {
                parent.postMessage({type: 'codeChange', code: this.get('code')}, '*');
            }.observes('code'),
            selectLanguageChanged: function () {
                this.launchSimulation();
            }.observes('selectedLanguage'),
            formattedTotalTime: function () {
                var totalTime = this.get('totalTime');
                var humanized = util.humanizeDuration(totalTime);
                return {humanized: humanized, detailed: Math.round(totalTime) + 's'};
            }.property('totalTime'),
            toolPosition: new util.Point(0, 0, 0),
            code: demoCode,
            jscode: demoJSCode,
            errors: [],
            bbox: {},
            totalTime: 0,
            lineSegmentMap: [],
            currentRow: null,
            simulatedPath: [],
            decorations: [],
            computing: false,
            fragmentFile: [],
            languages: ['gcode', 'javascript'],
            selectedLanguage: 'gcode',
            nextRequestIndex: 1
        });
    });
