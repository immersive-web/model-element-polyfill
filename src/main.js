import './style.css';

function addModel() {
  const model = document.createElement('model');
  model.src = '/cube-green.glb';
  document.getElementById('app').appendChild(model);
}

document.getElementById('add-model-button').addEventListener('click', addModel, { once: true });
