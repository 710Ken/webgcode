"use strict";
define(function () {

    function webglSupported() {
        try {
            var canvas = document.createElement('canvas');
            return !!window.WebGLRenderingContext && ( canvas.getContext('webgl') || canvas.getContext('experimental-webgl') );
        } catch (e) {
            return false;
        }
    }

    function ThreeDView($container) {
        var self = this;
        var WIDTH = $container.width();
        var HEIGHT = $container.height();
        if (webglSupported())
            this.renderer = new THREE.WebGLRenderer({antialias: true});
        else
            this.renderer = new THREE.CanvasRenderer();
        this.camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 20000);
        this.scene = new THREE.Scene();
        this.overlayScene = new THREE.Scene();
        this.camera.position.x = 30;
        this.camera.position.y = -30;
        this.camera.position.z = 60;
        this.camera.up.set(0, 0, 1);
        this.renderer.sortObjects = false;
        this.renderer.setSize(WIDTH, HEIGHT);
        this.renderer.autoClear = false;
        function resize() {
            self.camera.aspect = $container.width() / $container.height();
            self.camera.updateProjectionMatrix();
            self.renderer.setSize($container.width(), $container.height());
            self.reRender();
        }

        $(window).resize(resize);
        $container.append(this.renderer.domElement);
        this.scene.add(this.camera);
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.rotateSpeed = 1.0;
        this.controls.zoomSpeed = 1.2;
        this.controls.panSpeed = 0.8;
        this.controls.noZoom = false;
        this.controls.noPan = false;
        this.controls.staticMoving = true;
        this.controls.dynamicDampingFactor = 0.3;
        this.controls.minDistance = 3;
        this.controls.keys = [ 65, 83, 68 ];
        this.controls.addEventListener('change', function () {
            self.reRender();
        });
        function createGrid() {
            var size = 10, step = 5;
            var grid = new THREE.GridHelper(size, step);
            grid.applyMatrix(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            grid.setColors(0xFF7F2A, 0xFF7F2A);
            return  grid;
        }

        this.scene.add(createGrid());
        function createAxis(x, y, z, color) {
            return  new THREE.ArrowHelper(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, 0), 10, color, 1, 1);
        }

        var axes = new THREE.Object3D();
        axes.add(createAxis(10, 0, 0, 0xFF0000));
        axes.add(createAxis(0, 10, 0, 0x00FF00));
        axes.add(createAxis(0, 0, 10, 0x0000FF));
        this.overlayScene.add(axes);
        this.drawing = new THREE.Object3D();
        this.tool = new THREE.Object3D();
        var toolbit = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 10, 20, 2, false), new THREE.MeshPhongMaterial({emissive: 0xEF0000, specular: 0x0F0000, shininess: 204, color: 0xF0F0F0, opacity: 0.5, transparent: true}));
        toolbit.translateY(5);
        var spindle = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 15, 25, 2, false), new THREE.MeshPhongMaterial({emissive: 0xEFEFEF, specular: 0x0F0F0F, shininess: 204, color: 0xF0F0F0, opacity: 0.5, transparent: true}));
        spindle.translateY(17.5);
        this.tool.applyMatrix(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        this.tool.add(toolbit);
        this.tool.add(spindle);
        this.tool.matrixAutoUpdate = true;
        this.setToolVisibility(false);
        this.scene.add(this.tool);
        this.scene.add(this.drawing);
        this.toolpath = new THREE.Object3D();
        this.drawing.add(this.toolpath);
        this.normalMaterial = new THREE.LineBasicMaterial({linewidth: 1.5, color: 0xFFFFFF});
        this.rapidMaterial = new THREE.LineBasicMaterial({linewidth: 1.5, color: 0xFF0000});

        function animate() {
            requestAnimationFrame(animate);
            self.controls.update();
        }

        animate();
        this.reRender();
    }

    ThreeDView.prototype = {
        addToolpathFragment: function (toolpathObject, fragment) {
            var geom = new THREE.BufferGeometry();
            var float32Array = new Float32Array(fragment.vertices);
            geom.addAttribute('position', new THREE.Float32Attribute(float32Array.length / 3, 3));
            geom.attributes.position.array = float32Array;
            geom.verticesNeedUpdate = true;
            toolpathObject.add(new THREE.Line(geom, fragment.speedTag == 'rapid' ? this.rapidMaterial : this.normalMaterial));
            console.log('addToolpathFragment', fragment)
        },
        displayPath: function (path) {
            console.log('displayPath');
            this.clearToolpath();
            for (var i = 0; i < path.length; i++)
                this.addToolpathFragment(this.toolpath, path[i]);
            this.zoomExtent();
            return this.toolpath;
        },
        clearToolpath: function () {
            while (this.toolpath.children.length)
                this.toolpath.remove(this.toolpath.children[0]);
        },
        computeDrawingBBox: function () {
            var bbox = new THREE.Box3();
            this.drawing.updateMatrixWorld(true);
            this.drawing.traverse(function (node) {
                if (node.geometry) {
                    node.geometry.computeBoundingBox();
                    bbox.union(node.geometry.boundingBox);
                }
            });
            return bbox;
        },
        zoomExtent: function () {
            var bbox = this.computeDrawingBBox();
            var extentMiddle = bbox.center();
            this.controls.target = extentMiddle.clone();
            var cameraPos = extentMiddle.add(new THREE.Vector3(0, -40, 80));
            this.camera.position.copy(cameraPos);
            this.controls.update();
            this.reRender();
        },
        displayVector: function (origin, vector, color, id) {
            this.displayPath([origin, {x: origin.x + vector.x, y: origin.y + vector.y, z: origin.z + vector.z}]);
        },
        displayHighlight: function (polyline) {
            this.hideHighlight();
            var lineGeometry = new THREE.Geometry();
            for (var i = 0; i < polyline.length; i++)
                lineGeometry.vertices.push(new THREE.Vector3(polyline[i].x, polyline[i].y, polyline[i].z));
            lineGeometry.verticesNeedUpdate = true;
            var material = new THREE.LineBasicMaterial({depthWrite: false, overdraw: true, linewidth: 6, color: 0xFF00FF});
            this.highlight = new THREE.Line(lineGeometry, material);
            this.highlight.renderDepth = 1;
            this.overlayScene.add(this.highlight);
            this.reRender();
        },
        hideHighlight: function () {
            if (this.highlight) {
                this.overlayScene.remove(this.highlight);
                this.highlight = null;
                this.reRender();
            }
        },
        setToolVisibility: function (visible) {
            this.tool.traverse(function (child) {
                child.visible = visible;
            });
        },
        setToolPosition: function (x, y, z) {
            this.tool.position.setX(x);
            this.tool.position.setY(y);
            this.tool.position.setZ(z);
        },
        reRender: function () {
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
            if (this.renderer instanceof THREE.WebGLRenderer)
                this.renderer.clear(false, true, false);
            this.renderer.render(this.overlayScene, this.camera);
        }
    };
    return {ThreeDView: ThreeDView};
})
;