"use strict";

define(['libs/svg'], function () {
    function TwoDView(drawing) {
        //for firefox reason I added that
        //https://bugzilla.mozilla.org/show_bug.cgi?id=479058
        //http://stackoverflow.com/questions/15629183/svg-offset-issue-in-firefox
        var inserted = $('<div></div>');
        inserted.addClass('TwoDView');
        inserted.css('top', '0');
        drawing.append(inserted);
        this.svg = SVG(inserted[0]).size(drawing.width(), drawing.height());
        this.root = this.svg.group().attr({class: 'root', 'vector-effect': 'non-scaling-stroke'});
        this.background = this.root.group().attr({class: 'background', 'vector-effect': 'non-scaling-stroke'});
        this.paper = this.root.group().attr({class: 'paper', 'vector-effect': 'non-scaling-stroke'});
        var defs = this.svg.defs();
        var pattern = defs.pattern(6, 6,function () {
            var group = this.group();
            group.rect(6, 6).x(0).y(0);
            group.line(-1, 5, 7, 13);
            group.line(-1, 2, 7, 10);
            group.line(-1, -1, 7, 7);
            group.line(-1, -4, 7, 4);
            group.line(-1, -7, 7, 1);
        }).attr({id: 'computingFill'});
        $(defs.node).append(pattern);
        var origin = this.background.group().attr({class: 'origin'});
        origin.path('M0,0 L0,10 A 10,10 90 0 0 10,0 Z M0,0 L0,-10 A 10,10 90 0 0 -10,0 Z').attr({stroke: 'none', fill: 'red', transform: null});
        origin.ellipse(20, 20).cx(0).cy(0).attr({stroke: 'red', fill: 'none', transform: null});
        var grid = this.background.group().attr({class: 'grid'});
        var dmGrid = grid.group().attr({class: 'dmGrid'});
        var halfDmGrid = dmGrid.group().attr({class: 'halfDmGrid'});
        var cmGrid = halfDmGrid.group().attr({class: 'cmGrid'});
        var halfCmGrid = cmGrid.group().attr({class: 'halfCmGrid'});
        var mmGrid = halfCmGrid.group().attr({class: 'mmGrid'});
        this.gridStack = [
            [20, $(mmGrid.node)],
            [15, $(halfCmGrid.node)],
            [5, $(cmGrid.node)],
            [2.5, $(halfDmGrid.node)]
        ];
        var xSpan = 400;
        var ySpan = 600;
        var bigestSpan = Math.max(ySpan, xSpan);
        for (var i = -bigestSpan; i <= bigestSpan; i += 1) {
            var group = mmGrid;
            if (i % 100 == 0)
                group = dmGrid;
            else if (i % 50 == 0)
                group = halfDmGrid;
            else if (i % 10 == 0)
                group = cmGrid;
            else if (i % 5 == 0)
                group = halfCmGrid;
            if (Math.abs(i) <= ySpan)
                group.line(xSpan, i, -xSpan, i);
            if (Math.abs(i) <= xSpan)
                group.line(i, ySpan, i, -ySpan);
            if (i % 10 == 0) {
                if (Math.abs(i) <= xSpan)
                    group.text('' + i).transform({scaleY: -1}).attr({class: 'gridText '}).x(i).y(0);
                if (Math.abs(i) <= ySpan)
                    group.text('' + i).transform({scaleY: -1}).attr({class: 'gridText '}).x(0).y(i);
            }
        }
        var self = this;

        function getModelPositionForPageXY(x, y, matrix) {
            if (matrix == null)
                matrix = self.root.node.getCTM();
            //can't use offset with SVG in FF  http://stackoverflow.com/questions/15629183/svg-offset-issue-in-firefox
            var targetOffset = inserted.offset();
            var px = x - targetOffset.left;
            var py = y - targetOffset.top;
            var p = self.svg.node.createSVGPoint();
            p.x = px;
            p.y = py;
            p = p.matrixTransform(matrix.inverse());
            return {x: p.x, y: p.y};
        }

        drawing.mousewheel(function (event, delta, deltaX, deltaY) {
            var pos = getModelPositionForPageXY(event.pageX, event.pageY);
            var k = self.svg.node.createSVGMatrix().translate(pos.x, pos.y).scale(1 + deltaY / 360).translate(-pos.x, -pos.y);
            var m = self.root.node.getCTM().multiply(k);
            if (m.a > 0.4)
                self.setMatrix(self.root, m);
            event.preventDefault();
        });

        drawing.mousedown(function (event) {
            if (event.which != 1)
                return;
            var m = self.root.node.getCTM();
            var pos = getModelPositionForPageXY(event.pageX, event.pageY, m);
            self.mouseDownStartCondition = {x: event.pageX, y: event.pageY, matrix: m, modelPos: pos};
        });
        drawing.mouseup(function (event) {
            self.mouseDownStartCondition = null;
        });
        drawing.mouseleave(function (event) {
            self.mouseDownStartCondition = null;
        });
        drawing.mousemove(function (event) {
            if (self.mouseDownStartCondition) {
                var oldPos = self.mouseDownStartCondition.modelPos;
                var newPos = getModelPositionForPageXY(event.pageX, event.pageY, self.mouseDownStartCondition.matrix);
                var k = self.mouseDownStartCondition.matrix.translate(newPos.x - oldPos.x, newPos.y - oldPos.y);
                self.setMatrix(self.root, k);
            }
        });
        $(window).resize(function resizeSVG() {
            self.svg.size(drawing.width(), drawing.height());
        });
    }

    TwoDView.prototype = {
        clear: function () {
            this.paper.clear();
        },
        zoomExtent: function () {
            var paper = this.paper;
            var box = paper.bbox();
            var m = this.root.node.getCTM();
            var svg = this.svg.node;
            var newScale = Math.min(svg.width.baseVal.value / box.width, svg.height.baseVal.value / box.height) * 0.9;
            newScale = isFinite(newScale) ? newScale : 1;
            newScale = Math.abs(newScale);
            m.a = newScale;
            m.d = -newScale;
            m.e = -box.x + box.width * 0.25;
            m.f = -(-box.y + box.height * 0.5 - svg.height.baseVal.value);
            this.setMatrix(this.root, m);
        },
        setMatrix: function (element, matrix) {
            for (var i = 0; i < this.gridStack.length; i++)
                this.gridStack[i][1].css('visibility', matrix.a < this.gridStack[i][0] ? 'hidden' : 'visible');
            var components = $.map('abcdef'.split(''),function (c) {
                return matrix[c];
            }).join(',');
            element.attr({transform: 'matrix(' + components + ')'});
        }
    };

    return {TwoDView: TwoDView};
});

