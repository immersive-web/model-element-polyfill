import './style.css';

function addModel() {
  const model = document.createElement('model');
  model.src = 'green.glb';
  document.getElementById('app').appendChild(model);
}

document.getElementById('add-model-button').addEventListener('click', addModel, { once: true });
