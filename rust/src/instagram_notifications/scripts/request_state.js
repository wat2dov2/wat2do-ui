JSON.stringify((() => {
 const request = window["__wat2doInstagramBrowserRequest"];
 return request ? {result: request.result ?? null, settled: request.settled} : null;
})())