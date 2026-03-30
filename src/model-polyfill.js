import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

(function setupModelPolyfill() {
  if (typeof window === 'undefined') return;
  if ('HTMLModelElement' in window) return;

  function addDefaultStyle() {
    const id = 'model-polyfill-style';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      model { display: block; width: 500px; height: 300px; }
      model > canvas, model > img { max-width: 100%; height: auto; display: block; }
    `;
    document.head.appendChild(style);
  }
  addDefaultStyle();

  const stateMap = new WeakMap();

  function getState(el) {
    let state = stateMap.get(el);
    if (!state) {
      state = {
        readyState: 0,
        loadTimeout: null,
        renderer: null,
        scene: null,
        camera: null,
        resizeObserver: null,
        onWindowResize: null,
        canvas: null,
        mutationObserver: null,
        renderRoot: null,
        model: null,
      };
      stateMap.set(el, state);
    }
    return state;
  }

  class HTMLModelElement extends HTMLElement {
    get src() {
      const source = this.querySelector('source');
      return source ? source.getAttribute('src') : null;
    }

    set src(value) {
      let source = this.querySelector('source');
      if (!source) {
        source = document.createElement('source');
        this.prepend(source);
      }
      const next = value ?? '';
      if (source.getAttribute('src') !== next) {
        source.setAttribute('src', next);
      }
      this._queueLoad();
    }

    get readyState() {
      return getState(this).readyState;
    }

    async load() {
      const currentSrc = this.src;
      if (!currentSrc) {
        const state = getState(this);
        state.readyState = 0;
        this._teardownRenderer();
        return;
      }

      const state = getState(this);
      state.readyState = 1;
      this._teardownRenderer();

      try {
        let renderRoot = state.renderRoot;
        if (!renderRoot) {
          if (this.attachShadow) {
            try {
              renderRoot = this.attachShadow({ mode: 'open' });
            } catch (err) {
              renderRoot = null;
            }
          }
          if (!renderRoot) {
            const div = document.createElement('div');
            div.setAttribute('data-model-polyfill-root', '');
            Object.assign(div.style, {
              display: 'block',
              position: 'relative',
              width: '100%',
              height: '100%',
            });
            this.append(div);
            renderRoot = div;
          }
          state.renderRoot = renderRoot;
        }

        if ('innerHTML' in renderRoot) {
          renderRoot.innerHTML = '';
        } else {
          while (renderRoot.firstChild) {
            renderRoot.removeChild(renderRoot.firstChild);
          }
        }

        const canvas = document.createElement('canvas');
        renderRoot.appendChild(canvas);
        state.canvas = canvas;

        const { width, height } = this._measure();

        const DEFAULT_FOV = 60;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, width / height, 0.1, 100);
        camera.position.z = 3;

        const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.setSize(width, height);
        renderer.setClearColor(0x999999);

        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(10, 10, 10);
        scene.add(light);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(currentSrc);

        const model = gltf.scene;
        scene.add(model);
        state.model = model;

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.5 / maxDim;
        model.scale.multiplyScalar(scale);

        model.position.x = -center.x * scale;
        model.position.y = -center.y * scale;
        model.position.z = -center.z * scale;

        const animate = () => {
          if (!model) return;
          model.rotation.x += 0.01;
          model.rotation.y += 0.01;
          renderer.render(scene, camera);
        };
        renderer.setAnimationLoop(animate);

        const resizeObserver = new ResizeObserver(() => this._handleResize());
        resizeObserver.observe(this);
        state.resizeObserver = resizeObserver;

        if (!state.onWindowResize) {
          state.onWindowResize = () => this._handleResize();
        }
        window.addEventListener('resize', state.onWindowResize, { passive: true });

        state.renderer = renderer;
        state.scene = scene;
        state.camera = camera;

        state.readyState = 2;
        this.dispatchEvent(new Event('load'));
      } catch (error) {
        console.error('model polyfill load error', error);
        state.readyState = 0;
        const event = new CustomEvent('error', { detail: error });
        this.dispatchEvent(event);
      }
    }

    __modelInit() {
      if (this.__upgraded) return;
      this.__upgraded = true;

      const state = getState(this);
      state.mutationObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            if (mutation.target === this && mutation.attributeName === 'src') {
              this._mirrorSrcAttr();
              this._queueLoad();
            }
            if (mutation.target.nodeName === 'SOURCE' && mutation.attributeName === 'src') {
              this._queueLoad();
            }
          } else if (mutation.type === 'childList') {
            const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
            if (nodes.some((n) => n.nodeType === 1 && n.nodeName === 'SOURCE')) {
              this._queueLoad();
            }
          }
        }
      });

      state.mutationObserver.observe(this, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['src'],
      });

      this._mirrorSrcAttr();

      if (this.src) {
        this._queueLoad();
      }
    }

    _mirrorSrcAttr() {
      const attr = this.getAttribute('src');
      if (!attr) return;
      if (this.src !== attr) {
        this.src = attr;
      }
    }

    _queueLoad() {
      const state = getState(this);
      clearTimeout(state.loadTimeout);
      state.readyState = 1;
      state.loadTimeout = setTimeout(() => this.load(), 0);
    }

    _measure() {
      const rect = this.getBoundingClientRect();
      let width = rect.width;
      let height = rect.height;
      if (!width || !height) {
        width = this.clientWidth || 500;
        height = this.clientHeight || 300;
      }
      return { width, height };
    }

    _handleResize() {
      const state = getState(this);
      if (!state.renderer || !state.camera) return;
      const { width, height } = this._measure();
      if (height === 0) return;
      state.camera.aspect = width / height;
      state.camera.updateProjectionMatrix();
      state.renderer.setSize(width, height);
    }

    _teardownRenderer() {
      const state = getState(this);

      if (state.loadTimeout) {
        clearTimeout(state.loadTimeout);
        state.loadTimeout = null;
      }

      if (state.resizeObserver) {
        state.resizeObserver.disconnect();
        state.resizeObserver = null;
      }

      if (state.onWindowResize) {
        window.removeEventListener('resize', state.onWindowResize);
        state.onWindowResize = null;
      }

      if (state.renderer) {
        state.renderer.setAnimationLoop(null);
        state.renderer.dispose();
        if (typeof state.renderer.forceContextLoss === 'function') {
          state.renderer.forceContextLoss();
        }
        state.renderer = null;
      }

      if (state.scene) {
        if (state.model) {
          state.model.traverse((child) => {
            if (child.isMesh) {
              if (child.geometry) child.geometry.dispose?.();
              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material.forEach((m) => {
                    if (m.map) m.map.dispose?.();
                    m.dispose?.();
                  });
                } else {
                  if (child.material.map) child.material.map.dispose?.();
                  child.material.dispose?.();
                }
              }
            }
          });
          state.model = null;
        }

        for (const child of [...state.scene.children]) {
          state.scene.remove(child);
          if (child.geometry) child.geometry.dispose?.();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose?.());
            } else {
              child.material.dispose?.();
            }
          }
        }
        state.scene = null;
      }

      state.camera = null;

      if (state.canvas?.isConnected) {
        state.canvas.remove();
      }
      state.canvas = null;

      if (state.renderRoot && !(state.renderRoot instanceof ShadowRoot)) {
        state.renderRoot.innerHTML = '';
      }
    }
  }

  window.HTMLModelElement = HTMLModelElement;

  function upgrade(el) {
    if (!(el instanceof HTMLElement)) return;
    if (el.__upgraded) return;
    try {
      Object.setPrototypeOf(el, HTMLModelElement.prototype);
    } catch (error) {
      console.warn('Failed to set prototype for <model>', error);
    }
    el.__modelInit?.();
  }

  document.querySelectorAll('model').forEach(upgrade);

  const additionObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.nodeName === 'MODEL') {
          upgrade(node);
        }
        node.querySelectorAll?.('model').forEach(upgrade);
      }
    }
  });

  additionObserver.observe(document.documentElement, { childList: true, subtree: true });

  const originalCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function patchedCreateElement(name, options) {
    const element = originalCreateElement.call(this, name, options);
    if (String(name).toLowerCase() === 'model') {
      upgrade(element);
    }
    return element;
  };

  const originalCreateElementNS = Document.prototype.createElementNS;
  Document.prototype.createElementNS = function patchedCreateElementNS(namespace, name, options) {
    const element = originalCreateElementNS.call(this, namespace, name, options);
    if (String(name).toLowerCase() === 'model') {
      upgrade(element);
    }
    return element;
  };
})();
