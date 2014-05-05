"use strict";
define(['THREE', 'TWEEN', 'libs/threejs/OrbitControls', 'libs/threejs/CSS3DRenderer'], function (THREE, TWEEN, OrbitControls, CSS3DRenderer) {

    function webglSupported() {
        try {
            var canvas = document.createElement('canvas');
            return !!window.WebGLRenderingContext && ( canvas.getContext('webgl') || canvas.getContext('experimental-webgl') );
        } catch (e) {
            return false;
        }
    }

    function tweenVector(v) {
        return {x: v.x, y: v.y, z: v.z};
    }

    function createIcon(view) {
        var renderer = new THREE.CSS3DRenderer();
        renderer.setSize(100, 100);
        renderer.domElement.style.position = 'absolute';
        renderer.domElement.style.top = 0;
        $(renderer.domElement).addClass('viewCube');
        var scene = new THREE.Scene();
        var camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 100);
        camera.up.set(0, 0, 1);
        camera.position.set(200, 100, 250);
        var controls = new OrbitControls(camera, renderer.domElement);
        controls.noZoom = true;
        controls.noPan = true;
        controls.maxDistance = 250;
        controls.minDistance = 250;

        function myChangePropagator() {
            var radius = view.camera.position.clone().sub(view.controls.target).length();
            view.camera.position.copy(camera.position);
            view.camera.position.normalize().multiplyScalar(radius).add(view.controls.target);
            view.controls.update();
        }

        controls.addEventListener('change', function () {
            renderer.render(scene, camera);
        });
        controls.addEventListener('start', function () {
            view.controls.removeEventListener('change', updatePositionFromView);
            controls.addEventListener('change', myChangePropagator);
        });
        controls.addEventListener('end', function () {
            controls.removeEventListener('change', myChangePropagator);
            view.controls.addEventListener('change', updatePositionFromView);
        });
        var r = Math.PI / 2;
        var d = 50;
        var faces = [
            {pos: [d, 0, 0], rot: [r, r, 0], name: 'Right', camera: [1, 0, 0]},
            {pos: [-d, 0, 0], rot: [r, -r, 0], name: 'Left', camera: [-1, 0, 0]},
            {pos: [0, d, 0], rot: [-r, 0, 2 * r], name: 'Back', camera: [0, 1, 0]},
            {pos: [0, -d, 0], rot: [r, 0, 0], name: 'Front', camera: [0, -1, 0]},
            {pos: [0, 0, d], rot: [0, 0, 0], name: 'Top', camera: [0, 0, 1]},
            {pos: [0, 0, -d], rot: [0, 2 * r, 2 * r], name: 'Bottom', camera: [0, 0, -1]}
        ];
        var cube = new THREE.Object3D();
        scene.add(cube);
        function createFace(face) {
            var element = $('<div></div>')
                .html(face.name)
                .addClass('cubeFace');

            function clickHandler(event) {
                view.zoomExtent(new THREE.Vector3().fromArray(face.camera));
            }

            element.mousedown(function () {
                element.click(clickHandler);
                element.mousemove(function () {
                    element.unbind('click', clickHandler);
                });
            });
            var object = new THREE.CSS3DObject(element[0]);
            object.position.fromArray(face.pos);
            object.rotation.fromArray(face.rot);
            return object;
        }

        for (var i = 0; i < faces.length; i++)
            cube.add(createFace(faces[i]));
        renderer.render(scene, camera);
        function updatePositionFromView() {
            camera.position.copy(view.camera.position);
            camera.position.sub(view.controls.target);
            controls.update();
        }

        view.controls.addEventListener('change', updatePositionFromView);
        //updatePositionFromView();
        return $(renderer.domElement);
    }

    function ThreeDView($container) {
        var _this = this;
        var width = $container.width();
        var height = $container.height();
        if (webglSupported())
            this.renderer = new THREE.WebGLRenderer({antialias: true});
        else
            this.renderer = new THREE.CanvasRenderer();
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 20000);
        this.scene = new THREE.Scene();
        this.overlayScene = new THREE.Scene();
        this.camera.position.copy(new THREE.Vector3(0, -40, 80));
        this.camera.up.set(0, 0, 1);
        this.renderer.sortObjects = false;
        this.renderer.setSize(width, height);
        this.renderer.autoClear = false;
        function resize() {
            _this.camera.aspect = $container.width() / $container.height();
            _this.camera.updateProjectionMatrix();
            _this.renderer.setSize($container.width(), $container.height());
            _this.reRender();
        }

        $(window).resize(resize);
        $container.append(this.renderer.domElement);
        this.scene.add(this.camera);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
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
            _this.reRender();
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
            return new THREE.ArrowHelper(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, 0), 10, color, 1, 1);
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
        //needed because requestAnimationFrame can't pass a "this".
        this.requestAnimationFrameCallback = this.actuallyRender.bind(this);
        $container.prepend(createIcon(this));
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
        },
        displayPath: function (path) {
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
            var _this = this;
            this.drawing.traverse(function (node) {
                if (node.geometry) {
                    node.geometry.computeBoundingBox();
                    bbox.union(node.geometry.boundingBox.clone().applyMatrix4(_this.drawing.matrixWorld));
                }
            });
            return bbox;
        },
        zoomExtent: function (newRelativePosition) {
            var bbox = this.computeDrawingBBox();
            var extentMiddle = bbox.center();
            var radius = bbox.getBoundingSphere().radius;
            var previousTarget = this.controls.target.clone();
            new TWEEN.Tween(this.controls.target).to(tweenVector(extentMiddle), 500).start();
            var distance = radius / Math.tan(this.camera.fov / 2);
            var relativePosition = newRelativePosition != null ? newRelativePosition : this.camera.position.clone().sub(previousTarget);
            var newPosition = relativePosition.normalize().multiplyScalar(distance).add(extentMiddle);
            new TWEEN.Tween(this.camera.position).to(tweenVector(newPosition), 500).start();
            this.controls.update();
            this.reRender();
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
        actuallyRender: function (time) {
            this.renderRequested = false;
            var reanimate = TWEEN.update(time);
            this.controls.update();
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
            if (this.renderer instanceof THREE.WebGLRenderer)
                this.renderer.clear(false, true, false);
            this.renderer.render(this.overlayScene, this.camera);
            if (reanimate)
                this.reRender();
        },
        reRender: function () {
            if (!this.renderRequested) {
                this.renderRequested = true;
                requestAnimationFrame(this.requestAnimationFrameCallback);
            }
        }
    };
    return {ThreeDView: ThreeDView};
})
;