(() => {
 const input = document.querySelector('input[name="pass"]');
 if (!input) return "missing";
 input.focus();
 if (input.select) input.select();
 return "focused";
})()
