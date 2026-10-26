// PlayCanvas's import.meta.url fallback becomes an absolute build-machine path
// under webpack. Browser script loading already uses window.location below it.
// Keep the fallback runtime-relative without changing the public dependency.
module.exports = function publicScriptBase(source) {
  const needle = "let baseUrl = import.meta.url;";
  if (!source.includes(needle))
    throw Error(
      "PlayCanvas script handler changed; review public URL fallback adaptation",
    );
  return source.replace(
    needle,
    "let baseUrl = typeof location === 'object' ? location.href : 'file:///';",
  );
};
