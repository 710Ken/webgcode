requirejs.config({
    paths: {
        text: 'libs/require_text',
        Ember: "libs/ember-1.5.0-beta5.pre7",
        Handlebars: "libs/handlebars-v1.3.0",
        jQuery: "libs/jquery.min",
        THREE: 'libs/threejs/Three.min',
        TWEEN: 'libs/tween.min',
        ace: 'libs/ace/src-noconflict/ace',
        RSVP: 'libs/rsvp-latest'
    },
    shim: {
        jQuery: {exports: "$"},
        'libs/jquery.mousewheel': {deps: ["jQuery"]},
        Ember: {
            deps: ["jQuery", "Handlebars"],
            exports: "Ember"
        },
        THREE: {exports: 'THREE'},
        TWEEN: {exports: 'TWEEN'},
        'libs/threejs/OrbitControls': {deps: ['THREE'], exports: 'THREE.OrbitControls'},
        'libs/threejs/TrackballControls': {deps: ['THREE'], exports: 'THREE.TrackballControls'},
        'libs/threejs/CSS3DRenderer': {deps: ['THREE']},
        ace: {exports: 'ace'},
        'libs/svj.js': {exports: 'SVG'},
        RSVP: {exports: 'RSVP'}
    }
});