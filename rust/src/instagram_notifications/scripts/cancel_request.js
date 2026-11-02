(() => {
  const request = window["__wat2doInstagramBrowserRequest"];
  if (!request || request.settled) return "settled";
  request.controller.abort();
  return "pending";
})()