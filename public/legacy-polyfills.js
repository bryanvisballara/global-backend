(function () {
  if (typeof String.prototype.replaceAll === "function") {
    return;
  }

  String.prototype.replaceAll = function replaceAllPolyfill(search, replace) {
    const value = String(this);

    if (search instanceof RegExp) {
      if (!search.global) {
        throw new TypeError("String.prototype.replaceAll called with a non-global RegExp argument");
      }
      return value.replace(search, replace);
    }

    const searchString = String(search);
    if (searchString === "") {
      return value;
    }

    return value.split(searchString).join(String(replace));
  };
})();
