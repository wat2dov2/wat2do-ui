(() => {
 const input = document.querySelector('input[name="email"]');
 if (!input) return "missing";
 input.focus();
 if (input.select) input.select();
 return "focused";
})()
