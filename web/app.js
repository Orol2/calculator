const display = document.getElementById("display");
const keys = document.querySelector(".keys");

let expression = "0";

function refresh() {
  display.value = expression;
}

function append(value) {
  if (expression === "0" && value !== ".") {
    expression = value;
  } else {
    expression += value;
  }
  refresh();
}

function clearAll() {
  expression = "0";
  refresh();
}

function backspace() {
  expression = expression.length > 1 ? expression.slice(0, -1) : "0";
  refresh();
}

function calculate() {
  try {
    const result = Function(`"use strict"; return (${expression})`)();
    expression = Number.isFinite(result) ? String(result) : "Error";
  } catch {
    expression = "Error";
  }
  refresh();
}

keys.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const { value, action } = button.dataset;

  if (action === "clear") return clearAll();
  if (action === "delete") return backspace();
  if (action === "equals") return calculate();

  if (expression === "Error") {
    expression = "0";
  }

  append(value);
});
