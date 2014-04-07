"use strict";

define(['cnc/cam', 'libs/rbrush', 'cnc/ui/EmberTwoDView'], function (cam, rbrush, emberTwoDView) {

    function toggleClass(svgElement, className, toggle) {
        var classAttr = svgElement.attr('class');
        var classes = classAttr.split(' ');
        var index = classes.indexOf(className);
        if (toggle) {
            if (index == -1)
                svgElement.attr('class', classAttr + ' ' + className);
        } else if (index != -1) {
            classes.splice(index, 1);
            svgElement.attr('class', classes.join(' '));
        }
    }

    function simplifyScaleAndCreatePathDef(polygons, scale, tolerance, closed) {
        polygons = cam.simplifyPolygons(polygons, tolerance * scale);
        var d = '';
        polygons.forEach(function (poly) {
            var firstPoint = poly[0];
            d += ' M ' + firstPoint.X / scale + ',' + firstPoint.Y / scale;
            for (var i = 1; i < poly.length; i++)
                d += ' L ' + poly[i].X / scale + ',' + poly[i].Y / scale;
            if (closed)
                d += 'Z';
        });
        return d;
    }

    function unionBox(box1, box2) {
        var x = Math.min(box1.x, box2.x);
        var y = Math.min(box1.y, box2.y);
        var x2 = Math.max(box1.x + box1.width, box2.x + box2.width);
        var y2 = Math.max(box1.y + box1.height, box2.y + box2.height);
        return {x: x, y: y, width: x2 - x, height: y2 - y};
    }

    function getbBox(polygons, scale) {
        var minX = Number.POSITIVE_INFINITY;
        var maxX = Number.NEGATIVE_INFINITY;
        var minY = Number.POSITIVE_INFINITY;
        var maxY = Number.NEGATIVE_INFINITY;

        for (var i = 0; i < polygons.length; i++) {
            var polygon = polygons[i];
            for (var j = 0; j < polygon.length; j++) {
                var point = polygon[j];
                var x = point.X;
                minX = Math.min(x, minX);
                maxX = Math.max(x, maxX);
                var y = point.Y;
                minY = Math.min(y, minY);
                maxY = Math.max(y, maxY);
            }
        }
        return {x: minX / scale, y: minY / scale,
            width: (maxX - minX) / scale, height: (maxY - minY) / scale,
            x2: maxX / scale, y2: maxY / scale};
    }

    function lerp(min, max, ratio) {
        return min + ratio * (max - min);
    }

    function bboxIntersect(a, b) {
        return !(a.x >= b.x + b.width || a.y >= b.y + b.height
            || b.x >= a.x + a.width || b.y >= a.y + a.height);
    }

    var MultiLODPolylineView = Ember.Object.extend({
        lodLevels: [0.1, 0.5, 0.75, 1],
        init: function () {
            //parse and remove the css classes because they might be toggled later.
            var attrClasses = this.get('attr.class') || '';
            this.set('classes', attrClasses.split(' '));
            delete this.get('attr')['class'];
            this.set('lods', []);
            var bbox = getbBox(this.get('polyline'), cam.CLIPPER_SCALE);
            this.set('bbox', bbox);
            this.set('treeKey', [bbox.x, bbox.y, bbox.x2, bbox.y2, this]);
            this.refreshVisibility(this.get('operationView.nativeComponent.visibleBox'),
                this.get('operationView.nativeComponent.zoomLevel'));
        },
        willDestroy: function () {
            this.get('pathElement').remove();
        },
        toggleClass: function (className, toggle) {
            var lods = this.get('lods');
            for (var i = 0; i < lods.length; i++)
                if (lods[i])
                    toggleClass(lods[i], className, toggle);
            this.get('classes').removeObject(className);
            if (toggle)
                this.get('classes').pushObject(className);
        },
        installLodRepresentation: function (index) {
            var lods = this.get('lods');
            var newElement = isNaN(index) ? this.get('emptyPath') : lods[index];
            var element = this.get('pathElement');
            if (newElement == null) {
                var parent = this.get('parent');
                if (isNaN(index)) {
                    newElement = parent.group();
                    this.set('emptyPath', newElement);
                } else {
                    var interpolationPoints = this.get('lodLevels');
                    var minZoom = this.get('operationView.nativeComponent.minZoom');
                    var maxZoom = this.get('operationView.nativeComponent.maxZoom');
                    var d = simplifyScaleAndCreatePathDef(this.get('polyline'), cam.CLIPPER_SCALE,
                        0.5 / lerp(minZoom, maxZoom, interpolationPoints[index]), this.get('closed'));
                    newElement = parent.path(d).attr(this.get('attr')).attr({class: this.get('classes').join(' ')});
                    lods[index] = newElement;
                }
            }
            if (element != null && element != newElement)
                element.replace(newElement);
            this.set('pathElement', newElement);
        },
        computeLodIndex: function (zoomLevel) {
            var minZoom = this.get('operationView.nativeComponent.minZoom');
            var maxZoom = this.get('operationView.nativeComponent.maxZoom');
            var zoomRatio = (zoomLevel - minZoom) / (maxZoom - minZoom);
            var interpolationPoints = this.get('lodLevels');
            for (var i = 0; i < interpolationPoints.length; i++)
                if (zoomRatio < interpolationPoints[i])
                    return i;
            return interpolationPoints.length - 1;
        },
        refreshVisibility: function (viewBox, zoomLevel) {
            var lodIndex = this.computeLodIndex(zoomLevel);
            var visibility = bboxIntersect(viewBox, this.get('bbox')) && zoomLevel >= this.get('minVisibleZoomLevel');
            if (this.get('currentLodIndex') === lodIndex && this.get('currentVisibility') === visibility)
                return;
            this.set('currentLodIndex', lodIndex);
            this.set('currentVisibility', visibility);
            this.installLodRepresentation(visibility ? lodIndex : NaN);
        }
    });

    var PocketView = Ember.Object.extend({
        init: function () {
            this._super();
            this.set('layerViews', new Ember.Set());
            var tree = rbrush();
            this.set('tree', tree);
            var bbox = getbBox(this.get('pocket.polygon'), cam.CLIPPER_SCALE);
            this.set('treeKey', [bbox.x, bbox.y, bbox.x2, bbox.y2, this]);
            this.set('minVisibleZoomLevel', 1 / this.get('pocket.separation') * cam.CLIPPER_SCALE);
            this.set('outline', this.get('pocketGroup')
                .path(simplifyScaleAndCreatePathDef(this.get('pocket.polygon'), cam.CLIPPER_SCALE, 0.1, true))
                .attr({class: 'computing outline', fill: 'url(#computingFill)'}));
        },
        willDestroy: function () {
            while (this.get('layerViews.firstObject'))
                this.removePolyline(this.get('layerViews.firstObject'));
        },
        pocketGroupChanged: function () {
            var toolPathArray = this.get('pocket.toolPathArray');
            if (toolPathArray != null) {
                for (var i = 0; i < toolPathArray.length; i++)
                    this.recursivelyDisplayLayers(toolPathArray[i], this.get('pocketGroup'));
                toggleClass(this.get('outline'), 'computing', false);
                toggleClass(this.get('outline'), 'spiralPocketOutline',
                    this.get('operationView.nativeComponent.zoomLevel') < this.get('minVisibleZoomLevel'));
            }
        }.observes('pocket.toolPathArray').on('init'),
        undercutChanged: function () {
            if (this.get('pocket.undercut') != null)
                this.displayPolyline(this.get('pocket.undercut'), {class: 'undercut'}, this.get('minVisibleZoomLevel'));
        }.observes('pocket.undercut').on('init'),
        recursivelyDisplayLayers: function (pocket, group) {
            var minVisibleZoomLevel = this.get('minVisibleZoomLevel');
            for (var j = 0; j < pocket.children.length; j++)
                this.recursivelyDisplayLayers(pocket.children[j], group);
            if (pocket.spiraledToolPath) {
                this.displayPolyline(pocket.spiraledToolPath.shell, {class: 'spiralPocketOutline'}, minVisibleZoomLevel);
                this.displayPolyline([pocket.spiraledToolPath.path], {class: 'pocket'}, minVisibleZoomLevel);
            } else
                this.displayPolyline(pocket.contour, {class: 'pocket'}, minVisibleZoomLevel);
        },
        displayPolyline: function (polyline, attr, minZoomLevel, closed) {
            var params = {polyline: polyline, parent: this.get('pocketGroup'), operationView: this.get('operationView'),
                minVisibleZoomLevel: minZoomLevel, attr: attr, closed: closed};
            var polylineView = TextApplication.MultiLODPolylineView.create(params);
            this.get('tree').insert(polylineView.get('treeKey'));
            this.get('layerViews').add(polylineView);
            return polylineView;
        },
        removePolyline: function (polyline) {
            this.get('layerViews').remove(polyline);
            this.get('tree').remove(polyline.get('treeKey'));
            polyline.destroy();
            this.get('outline').remove();
        },
        refreshVisibility: function (viewBox, zoomLevel, refreshZone) {
            toggleClass(this.get('outline'), 'spiralPocketOutline', zoomLevel < this.get('minVisibleZoomLevel'));
            var refreshList = this.get('tree').search([refreshZone.x, refreshZone.y,
                refreshZone.x + refreshZone.width, refreshZone.y + refreshZone.height]);
            for (var i = 0; i < refreshList.length; i++)
                refreshList[i][4].refreshVisibility(viewBox, zoomLevel, refreshZone);
        }
    });
    var OperationView = Ember.View.extend({
        classNames: ['TwoDView'],
        pocketViews: [],
        init: function () {
            this._super();
            this.set('tree', rbrush());
        },
        didInsertElement: function () {
            var view = emberTwoDView.EmberTwoDView.create({element: this.$()});
            this.set('nativeComponent', view);
            this.set('pocketGroup', view.paper.group());
            var _this = this;
            var pocketViews = this.get('pocketViews');
            this.get('controller.pocketToolPaths').addArrayObserver({
                arrayWillChange: function (observedObj, start, removeCount, addCount) {
                    for (var i = 0; i < removeCount; i++) {
                        _this.get('tree').remove(pocketViews[start + i].get('treeKey'));
                        pocketViews[start + i].destroy();
                    }
                    pocketViews.splice(start, removeCount);
                },
                arrayDidChange: function (observedObj, start, removeCount, addCount) {
                    var pocketGroup = _this.get('pocketGroup');
                    var add = [];
                    for (var i = 0; i < addCount; i++)
                        add.pushObject(PocketView.create({pocket: observedObj[start + i],
                            pocketGroup: pocketGroup, operationView: _this}));
                    _this.get('tree').load(add.map(function (view) {
                        return view.get('treeKey');
                    }));
                    Array.prototype.splice.apply(pocketViews, [start, 0].concat(add));
                }
            });
        },
        viewPointWasChanged: function () {
            Ember.run.debounce(this, this.updateRepresentationsToView, 50);
        }.observes('nativeComponent.visibleBox'),
        updateRepresentationsToView: function () {
            var vbox = this.get('nativeComponent.visibleBox');
            if (vbox) {
                var previousVbox = this.get('vbox');
                var tree = this.get('tree');
                var union = previousVbox != null ? unionBox(vbox, previousVbox) : vbox;
                var refreshList = tree.search([union.x, union.y, union.x + union.width, union.y + union.height]);
                for (var i = 0; i < refreshList.length; i++)
                    refreshList[i][4].refreshVisibility(vbox, this.get('nativeComponent.zoomLevel'), union);
                this.set('vbox', vbox);
            }
        }.on('didInsertElement')
    });
    return {
        MultiLODPolylineView: MultiLODPolylineView,
        PocketView: PocketView,
        OperationView: OperationView};
});