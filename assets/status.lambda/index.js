"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/universal-user-agent/index.js
function getUserAgent() {
  if (typeof navigator === "object" && "userAgent" in navigator) {
    return navigator.userAgent;
  }
  if (typeof process === "object" && process.version !== void 0) {
    return `Node.js/${process.version.substr(1)} (${process.platform}; ${process.arch})`;
  }
  return "<environment undetectable>";
}
var init_universal_user_agent = __esm({
  "node_modules/universal-user-agent/index.js"() {
    "use strict";
  }
});

// node_modules/before-after-hook/lib/register.js
function register(state, name, method, options) {
  if (typeof method !== "function") {
    throw new Error("method for before hook must be a function");
  }
  if (!options) {
    options = {};
  }
  if (Array.isArray(name)) {
    return name.reverse().reduce((callback, name2) => {
      return register.bind(null, state, name2, callback, options);
    }, method)();
  }
  return Promise.resolve().then(() => {
    if (!state.registry[name]) {
      return method(options);
    }
    return state.registry[name].reduce((method2, registered) => {
      return registered.hook.bind(null, method2, options);
    }, method)();
  });
}
var init_register = __esm({
  "node_modules/before-after-hook/lib/register.js"() {
    "use strict";
  }
});

// node_modules/before-after-hook/lib/add.js
function addHook(state, kind, name, hook6) {
  const orig = hook6;
  if (!state.registry[name]) {
    state.registry[name] = [];
  }
  if (kind === "before") {
    hook6 = (method, options) => {
      return Promise.resolve().then(orig.bind(null, options)).then(method.bind(null, options));
    };
  }
  if (kind === "after") {
    hook6 = (method, options) => {
      let result;
      return Promise.resolve().then(method.bind(null, options)).then((result_) => {
        result = result_;
        return orig(result, options);
      }).then(() => {
        return result;
      });
    };
  }
  if (kind === "error") {
    hook6 = (method, options) => {
      return Promise.resolve().then(method.bind(null, options)).catch((error) => {
        return orig(error, options);
      });
    };
  }
  state.registry[name].push({
    hook: hook6,
    orig
  });
}
var init_add = __esm({
  "node_modules/before-after-hook/lib/add.js"() {
    "use strict";
  }
});

// node_modules/before-after-hook/lib/remove.js
function removeHook(state, name, method) {
  if (!state.registry[name]) {
    return;
  }
  const index = state.registry[name].map((registered) => {
    return registered.orig;
  }).indexOf(method);
  if (index === -1) {
    return;
  }
  state.registry[name].splice(index, 1);
}
var init_remove = __esm({
  "node_modules/before-after-hook/lib/remove.js"() {
    "use strict";
  }
});

// node_modules/before-after-hook/index.js
function bindApi(hook6, state, name) {
  const removeHookRef = bindable(removeHook, null).apply(
    null,
    name ? [state, name] : [state]
  );
  hook6.api = { remove: removeHookRef };
  hook6.remove = removeHookRef;
  ["before", "error", "after", "wrap"].forEach((kind) => {
    const args = name ? [state, kind, name] : [state, kind];
    hook6[kind] = hook6.api[kind] = bindable(addHook, null).apply(null, args);
  });
}
function Singular() {
  const singularHookName = /* @__PURE__ */ Symbol("Singular");
  const singularHookState = {
    registry: {}
  };
  const singularHook = register.bind(null, singularHookState, singularHookName);
  bindApi(singularHook, singularHookState, singularHookName);
  return singularHook;
}
function Collection() {
  const state = {
    registry: {}
  };
  const hook6 = register.bind(null, state);
  bindApi(hook6, state);
  return hook6;
}
var bind, bindable, before_after_hook_default;
var init_before_after_hook = __esm({
  "node_modules/before-after-hook/index.js"() {
    "use strict";
    init_register();
    init_add();
    init_remove();
    bind = Function.bind;
    bindable = bind.bind(bind);
    before_after_hook_default = { Singular, Collection };
  }
});

// node_modules/@octokit/endpoint/dist-bundle/index.js
function lowercaseKeys(object) {
  if (!object) {
    return {};
  }
  return Object.keys(object).reduce((newObj, key) => {
    newObj[key.toLowerCase()] = object[key];
    return newObj;
  }, {});
}
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) return false;
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const proto = Object.getPrototypeOf(value);
  if (proto === null) return true;
  const Ctor = Object.prototype.hasOwnProperty.call(proto, "constructor") && proto.constructor;
  return typeof Ctor === "function" && Ctor instanceof Ctor && Function.prototype.call(Ctor) === Function.prototype.call(value);
}
function mergeDeep(defaults, options) {
  const result = Object.assign({}, defaults);
  Object.keys(options).forEach((key) => {
    if (isPlainObject(options[key])) {
      if (!(key in defaults)) Object.assign(result, { [key]: options[key] });
      else result[key] = mergeDeep(defaults[key], options[key]);
    } else {
      Object.assign(result, { [key]: options[key] });
    }
  });
  return result;
}
function removeUndefinedProperties(obj) {
  for (const key in obj) {
    if (obj[key] === void 0) {
      delete obj[key];
    }
  }
  return obj;
}
function merge(defaults, route, options) {
  if (typeof route === "string") {
    let [method, url] = route.split(" ");
    options = Object.assign(url ? { method, url } : { url: method }, options);
  } else {
    options = Object.assign({}, route);
  }
  options.headers = lowercaseKeys(options.headers);
  removeUndefinedProperties(options);
  removeUndefinedProperties(options.headers);
  const mergedOptions = mergeDeep(defaults || {}, options);
  if (options.url === "/graphql") {
    if (defaults && defaults.mediaType.previews?.length) {
      mergedOptions.mediaType.previews = defaults.mediaType.previews.filter(
        (preview) => !mergedOptions.mediaType.previews.includes(preview)
      ).concat(mergedOptions.mediaType.previews);
    }
    mergedOptions.mediaType.previews = (mergedOptions.mediaType.previews || []).map((preview) => preview.replace(/-preview/, ""));
  }
  return mergedOptions;
}
function addQueryParameters(url, parameters) {
  const separator = /\?/.test(url) ? "&" : "?";
  const names = Object.keys(parameters);
  if (names.length === 0) {
    return url;
  }
  return url + separator + names.map((name) => {
    if (name === "q") {
      return "q=" + parameters.q.split("+").map(encodeURIComponent).join("+");
    }
    return `${name}=${encodeURIComponent(parameters[name])}`;
  }).join("&");
}
function removeNonChars(variableName) {
  return variableName.replace(/(?:^\W+)|(?:(?<!\W)\W+$)/g, "").split(/,/);
}
function extractUrlVariableNames(url) {
  const matches = url.match(urlVariableRegex);
  if (!matches) {
    return [];
  }
  return matches.map(removeNonChars).reduce((a, b) => a.concat(b), []);
}
function omit(object, keysToOmit) {
  const result = { __proto__: null };
  for (const key of Object.keys(object)) {
    if (keysToOmit.indexOf(key) === -1) {
      result[key] = object[key];
    }
  }
  return result;
}
function encodeReserved(str) {
  return str.split(/(%[0-9A-Fa-f]{2})/g).map(function(part) {
    if (!/%[0-9A-Fa-f]/.test(part)) {
      part = encodeURI(part).replace(/%5B/g, "[").replace(/%5D/g, "]");
    }
    return part;
  }).join("");
}
function encodeUnreserved(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}
function encodeValue(operator, value, key) {
  value = operator === "+" || operator === "#" ? encodeReserved(value) : encodeUnreserved(value);
  if (key) {
    return encodeUnreserved(key) + "=" + value;
  } else {
    return value;
  }
}
function isDefined(value) {
  return value !== void 0 && value !== null;
}
function isKeyOperator(operator) {
  return operator === ";" || operator === "&" || operator === "?";
}
function getValues(context, operator, key, modifier) {
  var value = context[key], result = [];
  if (isDefined(value) && value !== "") {
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
      value = value.toString();
      if (modifier && modifier !== "*") {
        value = value.substring(0, parseInt(modifier, 10));
      }
      result.push(
        encodeValue(operator, value, isKeyOperator(operator) ? key : "")
      );
    } else {
      if (modifier === "*") {
        if (Array.isArray(value)) {
          value.filter(isDefined).forEach(function(value2) {
            result.push(
              encodeValue(operator, value2, isKeyOperator(operator) ? key : "")
            );
          });
        } else {
          Object.keys(value).forEach(function(k) {
            if (isDefined(value[k])) {
              result.push(encodeValue(operator, value[k], k));
            }
          });
        }
      } else {
        const tmp = [];
        if (Array.isArray(value)) {
          value.filter(isDefined).forEach(function(value2) {
            tmp.push(encodeValue(operator, value2));
          });
        } else {
          Object.keys(value).forEach(function(k) {
            if (isDefined(value[k])) {
              tmp.push(encodeUnreserved(k));
              tmp.push(encodeValue(operator, value[k].toString()));
            }
          });
        }
        if (isKeyOperator(operator)) {
          result.push(encodeUnreserved(key) + "=" + tmp.join(","));
        } else if (tmp.length !== 0) {
          result.push(tmp.join(","));
        }
      }
    }
  } else {
    if (operator === ";") {
      if (isDefined(value)) {
        result.push(encodeUnreserved(key));
      }
    } else if (value === "" && (operator === "&" || operator === "?")) {
      result.push(encodeUnreserved(key) + "=");
    } else if (value === "") {
      result.push("");
    }
  }
  return result;
}
function parseUrl(template) {
  return {
    expand: expand.bind(null, template)
  };
}
function expand(template, context) {
  var operators = ["+", "#", ".", "/", ";", "?", "&"];
  template = template.replace(
    /\{([^\{\}]+)\}|([^\{\}]+)/g,
    function(_, expression, literal) {
      if (expression) {
        let operator = "";
        const values = [];
        if (operators.indexOf(expression.charAt(0)) !== -1) {
          operator = expression.charAt(0);
          expression = expression.substr(1);
        }
        expression.split(/,/g).forEach(function(variable) {
          var tmp = /([^:\*]*)(?::(\d+)|(\*))?/.exec(variable);
          values.push(getValues(context, operator, tmp[1], tmp[2] || tmp[3]));
        });
        if (operator && operator !== "+") {
          var separator = ",";
          if (operator === "?") {
            separator = "&";
          } else if (operator !== "#") {
            separator = operator;
          }
          return (values.length !== 0 ? operator : "") + values.join(separator);
        } else {
          return values.join(",");
        }
      } else {
        return encodeReserved(literal);
      }
    }
  );
  if (template === "/") {
    return template;
  } else {
    return template.replace(/\/$/, "");
  }
}
function parse(options) {
  let method = options.method.toUpperCase();
  let url = (options.url || "/").replace(/:([a-z]\w+)/g, "{$1}");
  let headers = Object.assign({}, options.headers);
  let body;
  let parameters = omit(options, [
    "method",
    "baseUrl",
    "url",
    "headers",
    "request",
    "mediaType"
  ]);
  const urlVariableNames = extractUrlVariableNames(url);
  url = parseUrl(url).expand(parameters);
  if (!/^http/.test(url)) {
    url = options.baseUrl + url;
  }
  const omittedParameters = Object.keys(options).filter((option) => urlVariableNames.includes(option)).concat("baseUrl");
  const remainingParameters = omit(parameters, omittedParameters);
  const isBinaryRequest = /application\/octet-stream/i.test(headers.accept);
  if (!isBinaryRequest) {
    if (options.mediaType.format) {
      headers.accept = headers.accept.split(/,/).map(
        (format) => format.replace(
          /application\/vnd(\.\w+)(\.v3)?(\.\w+)?(\+json)?$/,
          `application/vnd$1$2.${options.mediaType.format}`
        )
      ).join(",");
    }
    if (url.endsWith("/graphql")) {
      if (options.mediaType.previews?.length) {
        const previewsFromAcceptHeader = headers.accept.match(/(?<![\w-])[\w-]+(?=-preview)/g) || [];
        headers.accept = previewsFromAcceptHeader.concat(options.mediaType.previews).map((preview) => {
          const format = options.mediaType.format ? `.${options.mediaType.format}` : "+json";
          return `application/vnd.github.${preview}-preview${format}`;
        }).join(",");
      }
    }
  }
  if (["GET", "HEAD"].includes(method)) {
    url = addQueryParameters(url, remainingParameters);
  } else {
    if ("data" in remainingParameters) {
      body = remainingParameters.data;
    } else {
      if (Object.keys(remainingParameters).length) {
        body = remainingParameters;
      }
    }
  }
  if (!headers["content-type"] && typeof body !== "undefined") {
    headers["content-type"] = "application/json; charset=utf-8";
  }
  if (["PATCH", "PUT"].includes(method) && typeof body === "undefined") {
    body = "";
  }
  return Object.assign(
    { method, url, headers },
    typeof body !== "undefined" ? { body } : null,
    options.request ? { request: options.request } : null
  );
}
function endpointWithDefaults(defaults, route, options) {
  return parse(merge(defaults, route, options));
}
function withDefaults(oldDefaults, newDefaults) {
  const DEFAULTS2 = merge(oldDefaults, newDefaults);
  const endpoint2 = endpointWithDefaults.bind(null, DEFAULTS2);
  return Object.assign(endpoint2, {
    DEFAULTS: DEFAULTS2,
    defaults: withDefaults.bind(null, DEFAULTS2),
    merge: merge.bind(null, DEFAULTS2),
    parse
  });
}
var VERSION, userAgent, DEFAULTS, urlVariableRegex, endpoint;
var init_dist_bundle = __esm({
  "node_modules/@octokit/endpoint/dist-bundle/index.js"() {
    "use strict";
    init_universal_user_agent();
    VERSION = "0.0.0-development";
    userAgent = `octokit-endpoint.js/${VERSION} ${getUserAgent()}`;
    DEFAULTS = {
      method: "GET",
      baseUrl: "https://api.github.com",
      headers: {
        accept: "application/vnd.github.v3+json",
        "user-agent": userAgent
      },
      mediaType: {
        format: ""
      }
    };
    urlVariableRegex = /\{[^{}}]+\}/g;
    endpoint = withDefaults(null, DEFAULTS);
  }
});

// node_modules/fast-content-type-parse/index.js
var require_fast_content_type_parse = __commonJS({
  "node_modules/fast-content-type-parse/index.js"(exports2, module2) {
    "use strict";
    var NullObject = function NullObject2() {
    };
    NullObject.prototype = /* @__PURE__ */ Object.create(null);
    var paramRE = /; *([!#$%&'*+.^\w`|~-]+)=("(?:[\v\u0020\u0021\u0023-\u005b\u005d-\u007e\u0080-\u00ff]|\\[\v\u0020-\u00ff])*"|[!#$%&'*+.^\w`|~-]+) */gu;
    var quotedPairRE = /\\([\v\u0020-\u00ff])/gu;
    var mediaTypeRE = /^[!#$%&'*+.^\w|~-]+\/[!#$%&'*+.^\w|~-]+$/u;
    var defaultContentType = { type: "", parameters: new NullObject() };
    Object.freeze(defaultContentType.parameters);
    Object.freeze(defaultContentType);
    function parse2(header) {
      if (typeof header !== "string") {
        throw new TypeError("argument header is required and must be a string");
      }
      let index = header.indexOf(";");
      const type = index !== -1 ? header.slice(0, index).trim() : header.trim();
      if (mediaTypeRE.test(type) === false) {
        throw new TypeError("invalid media type");
      }
      const result = {
        type: type.toLowerCase(),
        parameters: new NullObject()
      };
      if (index === -1) {
        return result;
      }
      let key;
      let match;
      let value;
      paramRE.lastIndex = index;
      while (match = paramRE.exec(header)) {
        if (match.index !== index) {
          throw new TypeError("invalid parameter format");
        }
        index += match[0].length;
        key = match[1].toLowerCase();
        value = match[2];
        if (value[0] === '"') {
          value = value.slice(1, value.length - 1);
          quotedPairRE.test(value) && (value = value.replace(quotedPairRE, "$1"));
        }
        result.parameters[key] = value;
      }
      if (index !== header.length) {
        throw new TypeError("invalid parameter format");
      }
      return result;
    }
    function safeParse2(header) {
      if (typeof header !== "string") {
        return defaultContentType;
      }
      let index = header.indexOf(";");
      const type = index !== -1 ? header.slice(0, index).trim() : header.trim();
      if (mediaTypeRE.test(type) === false) {
        return defaultContentType;
      }
      const result = {
        type: type.toLowerCase(),
        parameters: new NullObject()
      };
      if (index === -1) {
        return result;
      }
      let key;
      let match;
      let value;
      paramRE.lastIndex = index;
      while (match = paramRE.exec(header)) {
        if (match.index !== index) {
          return defaultContentType;
        }
        index += match[0].length;
        key = match[1].toLowerCase();
        value = match[2];
        if (value[0] === '"') {
          value = value.slice(1, value.length - 1);
          quotedPairRE.test(value) && (value = value.replace(quotedPairRE, "$1"));
        }
        result.parameters[key] = value;
      }
      if (index !== header.length) {
        return defaultContentType;
      }
      return result;
    }
    module2.exports.default = { parse: parse2, safeParse: safeParse2 };
    module2.exports.parse = parse2;
    module2.exports.safeParse = safeParse2;
    module2.exports.defaultContentType = defaultContentType;
  }
});

// node_modules/json-with-bigint/json-with-bigint.js
var intRegex, noiseValue, originalStringify, originalParse, customFormat, bigIntsStringify, noiseStringify, JSONStringify, featureCache, isContextSourceSupported, convertMarkedBigIntsReviver, JSONParseV2, MAX_INT, MAX_DIGITS, stringsOrLargeNumbers, noiseValueWithQuotes, JSONParse;
var init_json_with_bigint = __esm({
  "node_modules/json-with-bigint/json-with-bigint.js"() {
    "use strict";
    intRegex = /^-?\d+$/;
    noiseValue = /^-?\d+n+$/;
    originalStringify = JSON.stringify;
    originalParse = JSON.parse;
    customFormat = /^-?\d+n$/;
    bigIntsStringify = /([\[:])?"(-?\d+)n"($|([\\n]|\s)*(\s|[\\n])*[,\}\]])/g;
    noiseStringify = /([\[:])?("-?\d+n+)n("$|"([\\n]|\s)*(\s|[\\n])*[,\}\]])/g;
    JSONStringify = (value, replacer, space) => {
      if ("rawJSON" in JSON) {
        return originalStringify(
          value,
          (key, value2) => {
            if (typeof value2 === "bigint") return JSON.rawJSON(value2.toString());
            if (typeof replacer === "function") return replacer(key, value2);
            if (Array.isArray(replacer) && replacer.includes(key)) return value2;
            return value2;
          },
          space
        );
      }
      if (!value) return originalStringify(value, replacer, space);
      const convertedToCustomJSON = originalStringify(
        value,
        (key, value2) => {
          const isNoise = typeof value2 === "string" && noiseValue.test(value2);
          if (isNoise) return value2.toString() + "n";
          if (typeof value2 === "bigint") return value2.toString() + "n";
          if (typeof replacer === "function") return replacer(key, value2);
          if (Array.isArray(replacer) && replacer.includes(key)) return value2;
          return value2;
        },
        space
      );
      const processedJSON = convertedToCustomJSON.replace(
        bigIntsStringify,
        "$1$2$3"
      );
      const denoisedJSON = processedJSON.replace(noiseStringify, "$1$2$3");
      return denoisedJSON;
    };
    featureCache = /* @__PURE__ */ new Map();
    isContextSourceSupported = () => {
      const parseFingerprint = JSON.parse.toString();
      if (featureCache.has(parseFingerprint)) {
        return featureCache.get(parseFingerprint);
      }
      try {
        const result = JSON.parse(
          "1",
          (_, __, context) => !!context?.source && context.source === "1"
        );
        featureCache.set(parseFingerprint, result);
        return result;
      } catch {
        featureCache.set(parseFingerprint, false);
        return false;
      }
    };
    convertMarkedBigIntsReviver = (key, value, context, userReviver) => {
      const isCustomFormatBigInt = typeof value === "string" && customFormat.test(value);
      if (isCustomFormatBigInt) return BigInt(value.slice(0, -1));
      const isNoiseValue = typeof value === "string" && noiseValue.test(value);
      if (isNoiseValue) return value.slice(0, -1);
      if (typeof userReviver !== "function") return value;
      return userReviver(key, value, context);
    };
    JSONParseV2 = (text, reviver) => {
      return JSON.parse(text, (key, value, context) => {
        const isBigNumber = typeof value === "number" && (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER);
        const isInt = context && intRegex.test(context.source);
        const isBigInt = isBigNumber && isInt;
        if (isBigInt) return BigInt(context.source);
        if (typeof reviver !== "function") return value;
        return reviver(key, value, context);
      });
    };
    MAX_INT = Number.MAX_SAFE_INTEGER.toString();
    MAX_DIGITS = MAX_INT.length;
    stringsOrLargeNumbers = /"(?:\\.|[^"])*"|-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/g;
    noiseValueWithQuotes = /^"-?\d+n+"$/;
    JSONParse = (text, reviver) => {
      if (!text) return originalParse(text, reviver);
      if (isContextSourceSupported()) return JSONParseV2(text, reviver);
      const serializedData = text.replace(
        stringsOrLargeNumbers,
        (text2, digits, fractional, exponential) => {
          const isString = text2[0] === '"';
          const isNoise = isString && noiseValueWithQuotes.test(text2);
          if (isNoise) return text2.substring(0, text2.length - 1) + 'n"';
          const isFractionalOrExponential = fractional || exponential;
          const isLessThanMaxSafeInt = digits && (digits.length < MAX_DIGITS || digits.length === MAX_DIGITS && digits <= MAX_INT);
          if (isString || isFractionalOrExponential || isLessThanMaxSafeInt)
            return text2;
          return '"' + text2 + 'n"';
        }
      );
      return originalParse(
        serializedData,
        (key, value, context) => convertMarkedBigIntsReviver(key, value, context, reviver)
      );
    };
  }
});

// node_modules/@octokit/request-error/dist-src/index.js
var RequestError;
var init_dist_src = __esm({
  "node_modules/@octokit/request-error/dist-src/index.js"() {
    "use strict";
    RequestError = class extends Error {
      name;
      /**
       * http status code
       */
      status;
      /**
       * Request options that lead to the error.
       */
      request;
      /**
       * Response object if a response was received
       */
      response;
      constructor(message, statusCode, options) {
        super(message, { cause: options.cause });
        this.name = "HttpError";
        this.status = Number.parseInt(statusCode);
        if (Number.isNaN(this.status)) {
          this.status = 0;
        }
        if ("response" in options) {
          this.response = options.response;
        }
        const requestCopy = Object.assign({}, options.request);
        if (options.request.headers.authorization) {
          requestCopy.headers = Object.assign({}, options.request.headers, {
            authorization: options.request.headers.authorization.replace(
              /(?<! ) .*$/,
              " [REDACTED]"
            )
          });
        }
        requestCopy.url = requestCopy.url.replace(/\bclient_secret=\w+/g, "client_secret=[REDACTED]").replace(/\baccess_token=\w+/g, "access_token=[REDACTED]");
        this.request = requestCopy;
      }
    };
  }
});

// node_modules/@octokit/request/dist-bundle/index.js
function isPlainObject2(value) {
  if (typeof value !== "object" || value === null) return false;
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const proto = Object.getPrototypeOf(value);
  if (proto === null) return true;
  const Ctor = Object.prototype.hasOwnProperty.call(proto, "constructor") && proto.constructor;
  return typeof Ctor === "function" && Ctor instanceof Ctor && Function.prototype.call(Ctor) === Function.prototype.call(value);
}
async function fetchWrapper(requestOptions) {
  const fetch = requestOptions.request?.fetch || globalThis.fetch;
  if (!fetch) {
    throw new Error(
      "fetch is not set. Please pass a fetch implementation as new Octokit({ request: { fetch }}). Learn more at https://github.com/octokit/octokit.js/#fetch-missing"
    );
  }
  const log = requestOptions.request?.log || console;
  const parseSuccessResponseBody = requestOptions.request?.parseSuccessResponseBody !== false;
  const body = isPlainObject2(requestOptions.body) || Array.isArray(requestOptions.body) ? JSONStringify(requestOptions.body) : requestOptions.body;
  const requestHeaders = Object.fromEntries(
    Object.entries(requestOptions.headers).map(([name, value]) => [
      name,
      String(value)
    ])
  );
  let fetchResponse;
  try {
    fetchResponse = await fetch(requestOptions.url, {
      method: requestOptions.method,
      body,
      redirect: requestOptions.request?.redirect,
      headers: requestHeaders,
      signal: requestOptions.request?.signal,
      // duplex must be set if request.body is ReadableStream or Async Iterables.
      // See https://fetch.spec.whatwg.org/#dom-requestinit-duplex.
      ...requestOptions.body && { duplex: "half" }
    });
  } catch (error) {
    let message = "Unknown Error";
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        error.status = 500;
        throw error;
      }
      message = error.message;
      if (error.name === "TypeError" && "cause" in error) {
        if (error.cause instanceof Error) {
          message = error.cause.message;
        } else if (typeof error.cause === "string") {
          message = error.cause;
        }
      }
    }
    const requestError = new RequestError(message, 500, {
      request: requestOptions
    });
    requestError.cause = error;
    throw requestError;
  }
  const status = fetchResponse.status;
  const url = fetchResponse.url;
  const responseHeaders = {};
  for (const [key, value] of fetchResponse.headers) {
    responseHeaders[key] = value;
  }
  const octokitResponse = {
    url,
    status,
    headers: responseHeaders,
    data: ""
  };
  if ("deprecation" in responseHeaders) {
    const matches = responseHeaders.link && responseHeaders.link.match(/<([^<>]+)>; rel="deprecation"/);
    const deprecationLink = matches && matches.pop();
    log.warn(
      `[@octokit/request] "${requestOptions.method} ${requestOptions.url}" is deprecated. It is scheduled to be removed on ${responseHeaders.sunset}${deprecationLink ? `. See ${deprecationLink}` : ""}`
    );
  }
  if (status === 204 || status === 205) {
    return octokitResponse;
  }
  if (requestOptions.method === "HEAD") {
    if (status < 400) {
      return octokitResponse;
    }
    throw new RequestError(fetchResponse.statusText, status, {
      response: octokitResponse,
      request: requestOptions
    });
  }
  if (status === 304) {
    octokitResponse.data = await getResponseData(fetchResponse);
    throw new RequestError("Not modified", status, {
      response: octokitResponse,
      request: requestOptions
    });
  }
  if (status >= 400) {
    octokitResponse.data = await getResponseData(fetchResponse);
    throw new RequestError(toErrorMessage(octokitResponse.data), status, {
      response: octokitResponse,
      request: requestOptions
    });
  }
  octokitResponse.data = parseSuccessResponseBody ? await getResponseData(fetchResponse) : fetchResponse.body;
  return octokitResponse;
}
async function getResponseData(response) {
  const contentType = response.headers.get("content-type");
  if (!contentType) {
    return response.text().catch(noop);
  }
  const mimetype = (0, import_fast_content_type_parse.safeParse)(contentType);
  if (isJSONResponse(mimetype)) {
    let text = "";
    try {
      text = await response.text();
      return JSONParse(text);
    } catch (err) {
      return text;
    }
  } else if (mimetype.type.startsWith("text/") || mimetype.parameters.charset?.toLowerCase() === "utf-8") {
    return response.text().catch(noop);
  } else {
    return response.arrayBuffer().catch(
      /* v8 ignore next -- @preserve */
      () => new ArrayBuffer(0)
    );
  }
}
function isJSONResponse(mimetype) {
  return mimetype.type === "application/json" || mimetype.type === "application/scim+json";
}
function toErrorMessage(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return "Unknown error";
  }
  if ("message" in data) {
    const suffix = "documentation_url" in data ? ` - ${data.documentation_url}` : "";
    return Array.isArray(data.errors) ? `${data.message}: ${data.errors.map((v) => JSON.stringify(v)).join(", ")}${suffix}` : `${data.message}${suffix}`;
  }
  return `Unknown error: ${JSON.stringify(data)}`;
}
function withDefaults2(oldEndpoint, newDefaults) {
  const endpoint2 = oldEndpoint.defaults(newDefaults);
  const newApi = function(route, parameters) {
    const endpointOptions = endpoint2.merge(route, parameters);
    if (!endpointOptions.request || !endpointOptions.request.hook) {
      return fetchWrapper(endpoint2.parse(endpointOptions));
    }
    const request2 = (route2, parameters2) => {
      return fetchWrapper(
        endpoint2.parse(endpoint2.merge(route2, parameters2))
      );
    };
    Object.assign(request2, {
      endpoint: endpoint2,
      defaults: withDefaults2.bind(null, endpoint2)
    });
    return endpointOptions.request.hook(request2, endpointOptions);
  };
  return Object.assign(newApi, {
    endpoint: endpoint2,
    defaults: withDefaults2.bind(null, endpoint2)
  });
}
var import_fast_content_type_parse, VERSION2, defaults_default, noop, request;
var init_dist_bundle2 = __esm({
  "node_modules/@octokit/request/dist-bundle/index.js"() {
    "use strict";
    init_dist_bundle();
    init_universal_user_agent();
    import_fast_content_type_parse = __toESM(require_fast_content_type_parse(), 1);
    init_json_with_bigint();
    init_dist_src();
    VERSION2 = "10.0.8";
    defaults_default = {
      headers: {
        "user-agent": `octokit-request.js/${VERSION2} ${getUserAgent()}`
      }
    };
    noop = () => "";
    request = withDefaults2(endpoint, defaults_default);
  }
});

// node_modules/@octokit/graphql/dist-bundle/index.js
function _buildMessageForResponseErrors(data) {
  return `Request failed due to following response errors:
` + data.errors.map((e) => ` - ${e.message}`).join("\n");
}
function graphql(request2, query, options) {
  if (options) {
    if (typeof query === "string" && "query" in options) {
      return Promise.reject(
        new Error(`[@octokit/graphql] "query" cannot be used as variable name`)
      );
    }
    for (const key in options) {
      if (!FORBIDDEN_VARIABLE_OPTIONS.includes(key)) continue;
      return Promise.reject(
        new Error(
          `[@octokit/graphql] "${key}" cannot be used as variable name`
        )
      );
    }
  }
  const parsedOptions = typeof query === "string" ? Object.assign({ query }, options) : query;
  const requestOptions = Object.keys(
    parsedOptions
  ).reduce((result, key) => {
    if (NON_VARIABLE_OPTIONS.includes(key)) {
      result[key] = parsedOptions[key];
      return result;
    }
    if (!result.variables) {
      result.variables = {};
    }
    result.variables[key] = parsedOptions[key];
    return result;
  }, {});
  const baseUrl = parsedOptions.baseUrl || request2.endpoint.DEFAULTS.baseUrl;
  if (GHES_V3_SUFFIX_REGEX.test(baseUrl)) {
    requestOptions.url = baseUrl.replace(GHES_V3_SUFFIX_REGEX, "/api/graphql");
  }
  return request2(requestOptions).then((response) => {
    if (response.data.errors) {
      const headers = {};
      for (const key of Object.keys(response.headers)) {
        headers[key] = response.headers[key];
      }
      throw new GraphqlResponseError(
        requestOptions,
        headers,
        response.data
      );
    }
    return response.data.data;
  });
}
function withDefaults3(request2, newDefaults) {
  const newRequest = request2.defaults(newDefaults);
  const newApi = (query, options) => {
    return graphql(newRequest, query, options);
  };
  return Object.assign(newApi, {
    defaults: withDefaults3.bind(null, newRequest),
    endpoint: newRequest.endpoint
  });
}
function withCustomRequest(customRequest) {
  return withDefaults3(customRequest, {
    method: "POST",
    url: "/graphql"
  });
}
var VERSION3, GraphqlResponseError, NON_VARIABLE_OPTIONS, FORBIDDEN_VARIABLE_OPTIONS, GHES_V3_SUFFIX_REGEX, graphql2;
var init_dist_bundle3 = __esm({
  "node_modules/@octokit/graphql/dist-bundle/index.js"() {
    "use strict";
    init_dist_bundle2();
    init_universal_user_agent();
    VERSION3 = "0.0.0-development";
    GraphqlResponseError = class extends Error {
      constructor(request2, headers, response) {
        super(_buildMessageForResponseErrors(response));
        this.request = request2;
        this.headers = headers;
        this.response = response;
        this.errors = response.errors;
        this.data = response.data;
        if (Error.captureStackTrace) {
          Error.captureStackTrace(this, this.constructor);
        }
      }
      name = "GraphqlResponseError";
      errors;
      data;
    };
    NON_VARIABLE_OPTIONS = [
      "method",
      "baseUrl",
      "url",
      "headers",
      "request",
      "query",
      "mediaType",
      "operationName"
    ];
    FORBIDDEN_VARIABLE_OPTIONS = ["query", "method", "url"];
    GHES_V3_SUFFIX_REGEX = /\/api\/v3\/?$/;
    graphql2 = withDefaults3(request, {
      headers: {
        "user-agent": `octokit-graphql.js/${VERSION3} ${getUserAgent()}`
      },
      method: "POST",
      url: "/graphql"
    });
  }
});

// node_modules/@octokit/auth-token/dist-bundle/index.js
async function auth(token) {
  const isApp = isJWT(token);
  const isInstallation = token.startsWith("v1.") || token.startsWith("ghs_");
  const isUserToServer = token.startsWith("ghu_");
  const tokenType = isApp ? "app" : isInstallation ? "installation" : isUserToServer ? "user-to-server" : "oauth";
  return {
    type: "token",
    token,
    tokenType
  };
}
function withAuthorizationPrefix(token) {
  if (token.split(/\./).length === 3) {
    return `bearer ${token}`;
  }
  return `token ${token}`;
}
async function hook(token, request2, route, parameters) {
  const endpoint2 = request2.endpoint.merge(
    route,
    parameters
  );
  endpoint2.headers.authorization = withAuthorizationPrefix(token);
  return request2(endpoint2);
}
var b64url, sep, jwtRE, isJWT, createTokenAuth;
var init_dist_bundle4 = __esm({
  "node_modules/@octokit/auth-token/dist-bundle/index.js"() {
    "use strict";
    b64url = "(?:[a-zA-Z0-9_-]+)";
    sep = "\\.";
    jwtRE = new RegExp(`^${b64url}${sep}${b64url}${sep}${b64url}$`);
    isJWT = jwtRE.test.bind(jwtRE);
    createTokenAuth = function createTokenAuth2(token) {
      if (!token) {
        throw new Error("[@octokit/auth-token] No token passed to createTokenAuth");
      }
      if (typeof token !== "string") {
        throw new Error(
          "[@octokit/auth-token] Token passed to createTokenAuth is not a string"
        );
      }
      token = token.replace(/^(token|bearer) +/i, "");
      return Object.assign(auth.bind(null, token), {
        hook: hook.bind(null, token)
      });
    };
  }
});

// node_modules/@octokit/core/dist-src/version.js
var VERSION4;
var init_version = __esm({
  "node_modules/@octokit/core/dist-src/version.js"() {
    "use strict";
    VERSION4 = "7.0.6";
  }
});

// node_modules/@octokit/core/dist-src/index.js
var dist_src_exports = {};
__export(dist_src_exports, {
  Octokit: () => Octokit
});
function createLogger(logger = {}) {
  if (typeof logger.debug !== "function") {
    logger.debug = noop2;
  }
  if (typeof logger.info !== "function") {
    logger.info = noop2;
  }
  if (typeof logger.warn !== "function") {
    logger.warn = consoleWarn;
  }
  if (typeof logger.error !== "function") {
    logger.error = consoleError;
  }
  return logger;
}
var noop2, consoleWarn, consoleError, userAgentTrail, Octokit;
var init_dist_src2 = __esm({
  "node_modules/@octokit/core/dist-src/index.js"() {
    "use strict";
    init_universal_user_agent();
    init_before_after_hook();
    init_dist_bundle2();
    init_dist_bundle3();
    init_dist_bundle4();
    init_version();
    noop2 = () => {
    };
    consoleWarn = console.warn.bind(console);
    consoleError = console.error.bind(console);
    userAgentTrail = `octokit-core.js/${VERSION4} ${getUserAgent()}`;
    Octokit = class {
      static VERSION = VERSION4;
      static defaults(defaults) {
        const OctokitWithDefaults = class extends this {
          constructor(...args) {
            const options = args[0] || {};
            if (typeof defaults === "function") {
              super(defaults(options));
              return;
            }
            super(
              Object.assign(
                {},
                defaults,
                options,
                options.userAgent && defaults.userAgent ? {
                  userAgent: `${options.userAgent} ${defaults.userAgent}`
                } : null
              )
            );
          }
        };
        return OctokitWithDefaults;
      }
      static plugins = [];
      /**
       * Attach a plugin (or many) to your Octokit instance.
       *
       * @example
       * const API = Octokit.plugin(plugin1, plugin2, plugin3, ...)
       */
      static plugin(...newPlugins) {
        const currentPlugins = this.plugins;
        const NewOctokit = class extends this {
          static plugins = currentPlugins.concat(
            newPlugins.filter((plugin) => !currentPlugins.includes(plugin))
          );
        };
        return NewOctokit;
      }
      constructor(options = {}) {
        const hook6 = new before_after_hook_default.Collection();
        const requestDefaults = {
          baseUrl: request.endpoint.DEFAULTS.baseUrl,
          headers: {},
          request: Object.assign({}, options.request, {
            // @ts-ignore internal usage only, no need to type
            hook: hook6.bind(null, "request")
          }),
          mediaType: {
            previews: [],
            format: ""
          }
        };
        requestDefaults.headers["user-agent"] = options.userAgent ? `${options.userAgent} ${userAgentTrail}` : userAgentTrail;
        if (options.baseUrl) {
          requestDefaults.baseUrl = options.baseUrl;
        }
        if (options.previews) {
          requestDefaults.mediaType.previews = options.previews;
        }
        if (options.timeZone) {
          requestDefaults.headers["time-zone"] = options.timeZone;
        }
        this.request = request.defaults(requestDefaults);
        this.graphql = withCustomRequest(this.request).defaults(requestDefaults);
        this.log = createLogger(options.log);
        this.hook = hook6;
        if (!options.authStrategy) {
          if (!options.auth) {
            this.auth = async () => ({
              type: "unauthenticated"
            });
          } else {
            const auth6 = createTokenAuth(options.auth);
            hook6.wrap("request", auth6.hook);
            this.auth = auth6;
          }
        } else {
          const { authStrategy, ...otherOptions } = options;
          const auth6 = authStrategy(
            Object.assign(
              {
                request: this.request,
                log: this.log,
                // we pass the current octokit instance as well as its constructor options
                // to allow for authentication strategies that return a new octokit instance
                // that shares the same internal state as the current one. The original
                // requirement for this was the "event-octokit" authentication strategy
                // of https://github.com/probot/octokit-auth-probot.
                octokit: this,
                octokitOptions: otherOptions
              },
              options.auth
            )
          );
          hook6.wrap("request", auth6.hook);
          this.auth = auth6;
        }
        const classConstructor = this.constructor;
        for (let i = 0; i < classConstructor.plugins.length; ++i) {
          Object.assign(this, classConstructor.plugins[i](this, options));
        }
      }
      // assigned during constructor
      request;
      graphql;
      log;
      hook;
      // TODO: type `octokit.auth` based on passed options.authStrategy
      auth;
    };
  }
});

// node_modules/@octokit/oauth-methods/dist-bundle/index.js
function requestToOAuthBaseUrl(request2) {
  const endpointDefaults = request2.endpoint.DEFAULTS;
  return /^https:\/\/(api\.)?github\.com$/.test(endpointDefaults.baseUrl) ? "https://github.com" : endpointDefaults.baseUrl.replace("/api/v3", "");
}
async function oauthRequest(request2, route, parameters) {
  const withOAuthParameters = {
    baseUrl: requestToOAuthBaseUrl(request2),
    headers: {
      accept: "application/json"
    },
    ...parameters
  };
  const response = await request2(route, withOAuthParameters);
  if ("error" in response.data) {
    const error = new RequestError(
      `${response.data.error_description} (${response.data.error}, ${response.data.error_uri})`,
      400,
      {
        request: request2.endpoint.merge(
          route,
          withOAuthParameters
        )
      }
    );
    error.response = response;
    throw error;
  }
  return response;
}
async function exchangeWebFlowCode(options) {
  const request2 = options.request || request;
  const response = await oauthRequest(
    request2,
    "POST /login/oauth/access_token",
    {
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUrl
    }
  );
  const authentication = {
    clientType: options.clientType,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    token: response.data.access_token,
    scopes: response.data.scope.split(/\s+/).filter(Boolean)
  };
  if (options.clientType === "github-app") {
    if ("refresh_token" in response.data) {
      const apiTimeInMs = new Date(response.headers.date).getTime();
      authentication.refreshToken = response.data.refresh_token, authentication.expiresAt = toTimestamp(
        apiTimeInMs,
        response.data.expires_in
      ), authentication.refreshTokenExpiresAt = toTimestamp(
        apiTimeInMs,
        response.data.refresh_token_expires_in
      );
    }
    delete authentication.scopes;
  }
  return { ...response, authentication };
}
function toTimestamp(apiTimeInMs, expirationInSeconds) {
  return new Date(apiTimeInMs + expirationInSeconds * 1e3).toISOString();
}
async function createDeviceCode(options) {
  const request2 = options.request || request;
  const parameters = {
    client_id: options.clientId
  };
  if ("scopes" in options && Array.isArray(options.scopes)) {
    parameters.scope = options.scopes.join(" ");
  }
  return oauthRequest(request2, "POST /login/device/code", parameters);
}
async function exchangeDeviceCode(options) {
  const request2 = options.request || request;
  const response = await oauthRequest(
    request2,
    "POST /login/oauth/access_token",
    {
      client_id: options.clientId,
      device_code: options.code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    }
  );
  const authentication = {
    clientType: options.clientType,
    clientId: options.clientId,
    token: response.data.access_token,
    scopes: response.data.scope.split(/\s+/).filter(Boolean)
  };
  if ("clientSecret" in options) {
    authentication.clientSecret = options.clientSecret;
  }
  if (options.clientType === "github-app") {
    if ("refresh_token" in response.data) {
      const apiTimeInMs = new Date(response.headers.date).getTime();
      authentication.refreshToken = response.data.refresh_token, authentication.expiresAt = toTimestamp2(
        apiTimeInMs,
        response.data.expires_in
      ), authentication.refreshTokenExpiresAt = toTimestamp2(
        apiTimeInMs,
        response.data.refresh_token_expires_in
      );
    }
    delete authentication.scopes;
  }
  return { ...response, authentication };
}
function toTimestamp2(apiTimeInMs, expirationInSeconds) {
  return new Date(apiTimeInMs + expirationInSeconds * 1e3).toISOString();
}
async function checkToken(options) {
  const request2 = options.request || request;
  const response = await request2("POST /applications/{client_id}/token", {
    headers: {
      authorization: `basic ${btoa(
        `${options.clientId}:${options.clientSecret}`
      )}`
    },
    client_id: options.clientId,
    access_token: options.token
  });
  const authentication = {
    clientType: options.clientType,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    token: options.token,
    scopes: response.data.scopes
  };
  if (response.data.expires_at)
    authentication.expiresAt = response.data.expires_at;
  if (options.clientType === "github-app") {
    delete authentication.scopes;
  }
  return { ...response, authentication };
}
async function refreshToken(options) {
  const request2 = options.request || request;
  const response = await oauthRequest(
    request2,
    "POST /login/oauth/access_token",
    {
      client_id: options.clientId,
      client_secret: options.clientSecret,
      grant_type: "refresh_token",
      refresh_token: options.refreshToken
    }
  );
  const apiTimeInMs = new Date(response.headers.date).getTime();
  const authentication = {
    clientType: "github-app",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    token: response.data.access_token,
    refreshToken: response.data.refresh_token,
    expiresAt: toTimestamp3(apiTimeInMs, response.data.expires_in),
    refreshTokenExpiresAt: toTimestamp3(
      apiTimeInMs,
      response.data.refresh_token_expires_in
    )
  };
  return { ...response, authentication };
}
function toTimestamp3(apiTimeInMs, expirationInSeconds) {
  return new Date(apiTimeInMs + expirationInSeconds * 1e3).toISOString();
}
async function resetToken(options) {
  const request2 = options.request || request;
  const auth6 = btoa(`${options.clientId}:${options.clientSecret}`);
  const response = await request2(
    "PATCH /applications/{client_id}/token",
    {
      headers: {
        authorization: `basic ${auth6}`
      },
      client_id: options.clientId,
      access_token: options.token
    }
  );
  const authentication = {
    clientType: options.clientType,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    token: response.data.token,
    scopes: response.data.scopes
  };
  if (response.data.expires_at)
    authentication.expiresAt = response.data.expires_at;
  if (options.clientType === "github-app") {
    delete authentication.scopes;
  }
  return { ...response, authentication };
}
async function deleteToken(options) {
  const request2 = options.request || request;
  const auth6 = btoa(`${options.clientId}:${options.clientSecret}`);
  return request2(
    "DELETE /applications/{client_id}/token",
    {
      headers: {
        authorization: `basic ${auth6}`
      },
      client_id: options.clientId,
      access_token: options.token
    }
  );
}
async function deleteAuthorization(options) {
  const request2 = options.request || request;
  const auth6 = btoa(`${options.clientId}:${options.clientSecret}`);
  return request2(
    "DELETE /applications/{client_id}/grant",
    {
      headers: {
        authorization: `basic ${auth6}`
      },
      client_id: options.clientId,
      access_token: options.token
    }
  );
}
var init_dist_bundle5 = __esm({
  "node_modules/@octokit/oauth-methods/dist-bundle/index.js"() {
    "use strict";
    init_dist_src();
    init_dist_bundle2();
    init_dist_bundle2();
    init_dist_bundle2();
    init_dist_bundle2();
    init_dist_bundle2();
    init_dist_bundle2();
    init_dist_bundle2();
    init_dist_bundle2();
  }
});

// node_modules/@octokit/auth-oauth-device/dist-bundle/index.js
async function getOAuthAccessToken(state, options) {
  const cachedAuthentication = getCachedAuthentication(state, options.auth);
  if (cachedAuthentication) return cachedAuthentication;
  const { data: verification } = await createDeviceCode({
    clientType: state.clientType,
    clientId: state.clientId,
    request: options.request || state.request,
    // @ts-expect-error the extra code to make TS happy is not worth it
    scopes: options.auth.scopes || state.scopes
  });
  await state.onVerification(verification);
  const authentication = await waitForAccessToken(
    options.request || state.request,
    state.clientId,
    state.clientType,
    verification
  );
  state.authentication = authentication;
  return authentication;
}
function getCachedAuthentication(state, auth22) {
  if (auth22.refresh === true) return false;
  if (!state.authentication) return false;
  if (state.clientType === "github-app") {
    return state.authentication;
  }
  const authentication = state.authentication;
  const newScope = ("scopes" in auth22 && auth22.scopes || state.scopes).join(
    " "
  );
  const currentScope = authentication.scopes.join(" ");
  return newScope === currentScope ? authentication : false;
}
async function wait(seconds) {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1e3));
}
async function waitForAccessToken(request2, clientId, clientType, verification) {
  try {
    const options = {
      clientId,
      request: request2,
      code: verification.device_code
    };
    const { authentication } = clientType === "oauth-app" ? await exchangeDeviceCode({
      ...options,
      clientType: "oauth-app"
    }) : await exchangeDeviceCode({
      ...options,
      clientType: "github-app"
    });
    return {
      type: "token",
      tokenType: "oauth",
      ...authentication
    };
  } catch (error) {
    if (!error.response) throw error;
    const errorType = error.response.data.error;
    if (errorType === "authorization_pending") {
      await wait(verification.interval);
      return waitForAccessToken(request2, clientId, clientType, verification);
    }
    if (errorType === "slow_down") {
      await wait(verification.interval + 7);
      return waitForAccessToken(request2, clientId, clientType, verification);
    }
    throw error;
  }
}
async function auth2(state, authOptions) {
  return getOAuthAccessToken(state, {
    auth: authOptions
  });
}
async function hook2(state, request2, route, parameters) {
  let endpoint2 = request2.endpoint.merge(
    route,
    parameters
  );
  if (/\/login\/(oauth\/access_token|device\/code)$/.test(endpoint2.url)) {
    return request2(endpoint2);
  }
  const { token } = await getOAuthAccessToken(state, {
    request: request2,
    auth: { type: "oauth" }
  });
  endpoint2.headers.authorization = `token ${token}`;
  return request2(endpoint2);
}
function createOAuthDeviceAuth(options) {
  const requestWithDefaults = options.request || request.defaults({
    headers: {
      "user-agent": `octokit-auth-oauth-device.js/${VERSION5} ${getUserAgent()}`
    }
  });
  const { request: request2 = requestWithDefaults, ...otherOptions } = options;
  const state = options.clientType === "github-app" ? {
    ...otherOptions,
    clientType: "github-app",
    request: request2
  } : {
    ...otherOptions,
    clientType: "oauth-app",
    request: request2,
    scopes: options.scopes || []
  };
  if (!options.clientId) {
    throw new Error(
      '[@octokit/auth-oauth-device] "clientId" option must be set (https://github.com/octokit/auth-oauth-device.js#usage)'
    );
  }
  if (!options.onVerification) {
    throw new Error(
      '[@octokit/auth-oauth-device] "onVerification" option must be a function (https://github.com/octokit/auth-oauth-device.js#usage)'
    );
  }
  return Object.assign(auth2.bind(null, state), {
    hook: hook2.bind(null, state)
  });
}
var VERSION5;
var init_dist_bundle6 = __esm({
  "node_modules/@octokit/auth-oauth-device/dist-bundle/index.js"() {
    "use strict";
    init_universal_user_agent();
    init_dist_bundle2();
    init_dist_bundle5();
    VERSION5 = "0.0.0-development";
  }
});

// node_modules/@octokit/auth-oauth-user/dist-bundle/index.js
async function getAuthentication(state) {
  if ("code" in state.strategyOptions) {
    const { authentication } = await exchangeWebFlowCode({
      clientId: state.clientId,
      clientSecret: state.clientSecret,
      clientType: state.clientType,
      onTokenCreated: state.onTokenCreated,
      ...state.strategyOptions,
      request: state.request
    });
    return {
      type: "token",
      tokenType: "oauth",
      ...authentication
    };
  }
  if ("onVerification" in state.strategyOptions) {
    const deviceAuth = createOAuthDeviceAuth({
      clientType: state.clientType,
      clientId: state.clientId,
      onTokenCreated: state.onTokenCreated,
      ...state.strategyOptions,
      request: state.request
    });
    const authentication = await deviceAuth({
      type: "oauth"
    });
    return {
      clientSecret: state.clientSecret,
      ...authentication
    };
  }
  if ("token" in state.strategyOptions) {
    return {
      type: "token",
      tokenType: "oauth",
      clientId: state.clientId,
      clientSecret: state.clientSecret,
      clientType: state.clientType,
      onTokenCreated: state.onTokenCreated,
      ...state.strategyOptions
    };
  }
  throw new Error("[@octokit/auth-oauth-user] Invalid strategy options");
}
async function auth3(state, options = {}) {
  if (!state.authentication) {
    state.authentication = state.clientType === "oauth-app" ? await getAuthentication(state) : await getAuthentication(state);
  }
  if (state.authentication.invalid) {
    throw new Error("[@octokit/auth-oauth-user] Token is invalid");
  }
  const currentAuthentication = state.authentication;
  if ("expiresAt" in currentAuthentication) {
    if (options.type === "refresh" || new Date(currentAuthentication.expiresAt) < /* @__PURE__ */ new Date()) {
      const { authentication } = await refreshToken({
        clientType: "github-app",
        clientId: state.clientId,
        clientSecret: state.clientSecret,
        refreshToken: currentAuthentication.refreshToken,
        request: state.request
      });
      state.authentication = {
        tokenType: "oauth",
        type: "token",
        ...authentication
      };
    }
  }
  if (options.type === "refresh") {
    if (state.clientType === "oauth-app") {
      throw new Error(
        "[@octokit/auth-oauth-user] OAuth Apps do not support expiring tokens"
      );
    }
    if (!currentAuthentication.hasOwnProperty("expiresAt")) {
      throw new Error("[@octokit/auth-oauth-user] Refresh token missing");
    }
    await state.onTokenCreated?.(state.authentication, {
      type: options.type
    });
  }
  if (options.type === "check" || options.type === "reset") {
    const method = options.type === "check" ? checkToken : resetToken;
    try {
      const { authentication } = await method({
        // @ts-expect-error making TS happy would require unnecessary code so no
        clientType: state.clientType,
        clientId: state.clientId,
        clientSecret: state.clientSecret,
        token: state.authentication.token,
        request: state.request
      });
      state.authentication = {
        tokenType: "oauth",
        type: "token",
        // @ts-expect-error TBD
        ...authentication
      };
      if (options.type === "reset") {
        await state.onTokenCreated?.(state.authentication, {
          type: options.type
        });
      }
      return state.authentication;
    } catch (error) {
      if (error.status === 404) {
        error.message = "[@octokit/auth-oauth-user] Token is invalid";
        state.authentication.invalid = true;
      }
      throw error;
    }
  }
  if (options.type === "delete" || options.type === "deleteAuthorization") {
    const method = options.type === "delete" ? deleteToken : deleteAuthorization;
    try {
      await method({
        // @ts-expect-error making TS happy would require unnecessary code so no
        clientType: state.clientType,
        clientId: state.clientId,
        clientSecret: state.clientSecret,
        token: state.authentication.token,
        request: state.request
      });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    state.authentication.invalid = true;
    return state.authentication;
  }
  return state.authentication;
}
function requiresBasicAuth(url) {
  return url && ROUTES_REQUIRING_BASIC_AUTH.test(url);
}
async function hook3(state, request2, route, parameters = {}) {
  const endpoint2 = request2.endpoint.merge(
    route,
    parameters
  );
  if (/\/login\/(oauth\/access_token|device\/code)$/.test(endpoint2.url)) {
    return request2(endpoint2);
  }
  if (requiresBasicAuth(endpoint2.url)) {
    const credentials = btoa(`${state.clientId}:${state.clientSecret}`);
    endpoint2.headers.authorization = `basic ${credentials}`;
    return request2(endpoint2);
  }
  const { token } = state.clientType === "oauth-app" ? await auth3({ ...state, request: request2 }) : await auth3({ ...state, request: request2 });
  endpoint2.headers.authorization = "token " + token;
  return request2(endpoint2);
}
function createOAuthUserAuth({
  clientId,
  clientSecret,
  clientType = "oauth-app",
  request: request2 = request.defaults({
    headers: {
      "user-agent": `octokit-auth-oauth-app.js/${VERSION6} ${getUserAgent()}`
    }
  }),
  onTokenCreated,
  ...strategyOptions
}) {
  const state = Object.assign({
    clientType,
    clientId,
    clientSecret,
    onTokenCreated,
    strategyOptions,
    request: request2
  });
  return Object.assign(auth3.bind(null, state), {
    // @ts-expect-error not worth the extra code needed to appease TS
    hook: hook3.bind(null, state)
  });
}
var VERSION6, ROUTES_REQUIRING_BASIC_AUTH;
var init_dist_bundle7 = __esm({
  "node_modules/@octokit/auth-oauth-user/dist-bundle/index.js"() {
    "use strict";
    init_universal_user_agent();
    init_dist_bundle2();
    init_dist_bundle6();
    init_dist_bundle5();
    init_dist_bundle5();
    VERSION6 = "0.0.0-development";
    ROUTES_REQUIRING_BASIC_AUTH = /\/applications\/[^/]+\/(token|grant)s?/;
    createOAuthUserAuth.VERSION = VERSION6;
  }
});

// node_modules/@octokit/auth-oauth-app/dist-bundle/index.js
async function auth4(state, authOptions) {
  if (authOptions.type === "oauth-app") {
    return {
      type: "oauth-app",
      clientId: state.clientId,
      clientSecret: state.clientSecret,
      clientType: state.clientType,
      headers: {
        authorization: `basic ${btoa(
          `${state.clientId}:${state.clientSecret}`
        )}`
      }
    };
  }
  if ("factory" in authOptions) {
    const { type, ...options } = {
      ...authOptions,
      ...state
    };
    return authOptions.factory(options);
  }
  const common = {
    clientId: state.clientId,
    clientSecret: state.clientSecret,
    request: state.request,
    ...authOptions
  };
  const userAuth = state.clientType === "oauth-app" ? await createOAuthUserAuth({
    ...common,
    clientType: state.clientType
  }) : await createOAuthUserAuth({
    ...common,
    clientType: state.clientType
  });
  return userAuth();
}
async function hook4(state, request2, route, parameters) {
  let endpoint2 = request2.endpoint.merge(
    route,
    parameters
  );
  if (/\/login\/(oauth\/access_token|device\/code)$/.test(endpoint2.url)) {
    return request2(endpoint2);
  }
  if (state.clientType === "github-app" && !requiresBasicAuth(endpoint2.url)) {
    throw new Error(
      `[@octokit/auth-oauth-app] GitHub Apps cannot use their client ID/secret for basic authentication for endpoints other than "/applications/{client_id}/**". "${endpoint2.method} ${endpoint2.url}" is not supported.`
    );
  }
  const credentials = btoa(`${state.clientId}:${state.clientSecret}`);
  endpoint2.headers.authorization = `basic ${credentials}`;
  try {
    return await request2(endpoint2);
  } catch (error) {
    if (error.status !== 401) throw error;
    error.message = `[@octokit/auth-oauth-app] "${endpoint2.method} ${endpoint2.url}" does not support clientId/clientSecret basic authentication.`;
    throw error;
  }
}
function createOAuthAppAuth(options) {
  const state = Object.assign(
    {
      request: request.defaults({
        headers: {
          "user-agent": `octokit-auth-oauth-app.js/${VERSION7} ${getUserAgent()}`
        }
      }),
      clientType: "oauth-app"
    },
    options
  );
  return Object.assign(auth4.bind(null, state), {
    hook: hook4.bind(null, state)
  });
}
var VERSION7;
var init_dist_bundle8 = __esm({
  "node_modules/@octokit/auth-oauth-app/dist-bundle/index.js"() {
    "use strict";
    init_universal_user_agent();
    init_dist_bundle2();
    init_dist_bundle7();
    init_dist_bundle7();
    VERSION7 = "0.0.0-development";
  }
});

// node_modules/universal-github-app-jwt/lib/utils.js
function isPkcs1(privateKey) {
  return privateKey.includes("-----BEGIN RSA PRIVATE KEY-----");
}
function isOpenSsh(privateKey) {
  return privateKey.includes("-----BEGIN OPENSSH PRIVATE KEY-----");
}
function string2ArrayBuffer(str) {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}
function getDERfromPEM(pem) {
  const pemB64 = pem.trim().split("\n").slice(1, -1).join("");
  const decoded = atob(pemB64);
  return string2ArrayBuffer(decoded);
}
function getEncodedMessage(header, payload) {
  return `${base64encodeJSON(header)}.${base64encodeJSON(payload)}`;
}
function base64encode(buffer) {
  var binary = "";
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return fromBase64(btoa(binary));
}
function fromBase64(base64) {
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64encodeJSON(obj) {
  return fromBase64(btoa(JSON.stringify(obj)));
}
var init_utils = __esm({
  "node_modules/universal-github-app-jwt/lib/utils.js"() {
    "use strict";
  }
});

// node_modules/universal-github-app-jwt/lib/crypto-node.js
function convertPrivateKey(privateKey) {
  if (!isPkcs1(privateKey)) return privateKey;
  return (0, import_node_crypto2.createPrivateKey)(privateKey).export({
    type: "pkcs8",
    format: "pem"
  });
}
var import_node_crypto, import_node_crypto2;
var init_crypto_node = __esm({
  "node_modules/universal-github-app-jwt/lib/crypto-node.js"() {
    "use strict";
    import_node_crypto = require("node:crypto");
    import_node_crypto2 = require("node:crypto");
    init_utils();
  }
});

// node_modules/universal-github-app-jwt/lib/get-token.js
async function getToken({ privateKey, payload }) {
  const convertedPrivateKey = convertPrivateKey(privateKey);
  if (isPkcs1(convertedPrivateKey)) {
    throw new Error(
      "[universal-github-app-jwt] Private Key is in PKCS#1 format, but only PKCS#8 is supported. See https://github.com/gr2m/universal-github-app-jwt#private-key-formats"
    );
  }
  if (isOpenSsh(convertedPrivateKey)) {
    throw new Error(
      "[universal-github-app-jwt] Private Key is in OpenSSH format, but only PKCS#8 is supported. See https://github.com/gr2m/universal-github-app-jwt#private-key-formats"
    );
  }
  const algorithm = {
    name: "RSASSA-PKCS1-v1_5",
    hash: { name: "SHA-256" }
  };
  const header = { alg: "RS256", typ: "JWT" };
  const privateKeyDER = getDERfromPEM(convertedPrivateKey);
  const importedKey = await import_node_crypto.subtle.importKey(
    "pkcs8",
    privateKeyDER,
    algorithm,
    false,
    ["sign"]
  );
  const encodedMessage = getEncodedMessage(header, payload);
  const encodedMessageArrBuf = string2ArrayBuffer(encodedMessage);
  const signatureArrBuf = await import_node_crypto.subtle.sign(
    algorithm.name,
    importedKey,
    encodedMessageArrBuf
  );
  const encodedSignature = base64encode(signatureArrBuf);
  return `${encodedMessage}.${encodedSignature}`;
}
var init_get_token = __esm({
  "node_modules/universal-github-app-jwt/lib/get-token.js"() {
    "use strict";
    init_utils();
    init_crypto_node();
  }
});

// node_modules/universal-github-app-jwt/index.js
async function githubAppJwt({
  id,
  privateKey,
  now = Math.floor(Date.now() / 1e3)
}) {
  const privateKeyWithNewlines = privateKey.replace(/\\n/g, "\n");
  const nowWithSafetyMargin = now - 30;
  const expiration = nowWithSafetyMargin + 60 * 10;
  const payload = {
    iat: nowWithSafetyMargin,
    // Issued at time
    exp: expiration,
    iss: id
  };
  const token = await getToken({
    privateKey: privateKeyWithNewlines,
    payload
  });
  return {
    appId: id,
    expiration,
    token
  };
}
var init_universal_github_app_jwt = __esm({
  "node_modules/universal-github-app-jwt/index.js"() {
    "use strict";
    init_get_token();
  }
});

// node_modules/toad-cache/dist/toad-cache.mjs
var LruObject;
var init_toad_cache = __esm({
  "node_modules/toad-cache/dist/toad-cache.mjs"() {
    "use strict";
    LruObject = class {
      constructor(max = 1e3, ttlInMsecs = 0) {
        if (isNaN(max) || max < 0) {
          throw new Error("Invalid max value");
        }
        if (isNaN(ttlInMsecs) || ttlInMsecs < 0) {
          throw new Error("Invalid ttl value");
        }
        this.first = null;
        this.items = /* @__PURE__ */ Object.create(null);
        this.last = null;
        this.size = 0;
        this.max = max;
        this.ttl = ttlInMsecs;
      }
      bumpLru(item) {
        if (this.last === item) {
          return;
        }
        const last = this.last;
        const next = item.next;
        const prev = item.prev;
        if (this.first === item) {
          this.first = next;
        }
        item.next = null;
        item.prev = last;
        last.next = item;
        if (prev !== null) {
          prev.next = next;
        }
        if (next !== null) {
          next.prev = prev;
        }
        this.last = item;
      }
      clear() {
        this.items = /* @__PURE__ */ Object.create(null);
        this.first = null;
        this.last = null;
        this.size = 0;
      }
      delete(key) {
        if (Object.prototype.hasOwnProperty.call(this.items, key)) {
          const item = this.items[key];
          delete this.items[key];
          this.size--;
          if (item.prev !== null) {
            item.prev.next = item.next;
          }
          if (item.next !== null) {
            item.next.prev = item.prev;
          }
          if (this.first === item) {
            this.first = item.next;
          }
          if (this.last === item) {
            this.last = item.prev;
          }
        }
      }
      deleteMany(keys) {
        for (var i = 0; i < keys.length; i++) {
          this.delete(keys[i]);
        }
      }
      evict() {
        if (this.size > 0) {
          const item = this.first;
          delete this.items[item.key];
          if (--this.size === 0) {
            this.first = null;
            this.last = null;
          } else {
            this.first = item.next;
            this.first.prev = null;
          }
        }
      }
      expiresAt(key) {
        if (Object.prototype.hasOwnProperty.call(this.items, key)) {
          return this.items[key].expiry;
        }
      }
      get(key) {
        if (Object.prototype.hasOwnProperty.call(this.items, key)) {
          const item = this.items[key];
          if (this.ttl > 0 && item.expiry <= Date.now()) {
            this.delete(key);
            return;
          }
          this.bumpLru(item);
          return item.value;
        }
      }
      getMany(keys) {
        const result = [];
        for (var i = 0; i < keys.length; i++) {
          result.push(this.get(keys[i]));
        }
        return result;
      }
      keys() {
        return Object.keys(this.items);
      }
      set(key, value) {
        if (Object.prototype.hasOwnProperty.call(this.items, key)) {
          const item2 = this.items[key];
          item2.value = value;
          item2.expiry = this.ttl > 0 ? Date.now() + this.ttl : this.ttl;
          if (this.last !== item2) {
            this.bumpLru(item2);
          }
          return;
        }
        if (this.max > 0 && this.size === this.max) {
          this.evict();
        }
        const item = {
          expiry: this.ttl > 0 ? Date.now() + this.ttl : this.ttl,
          key,
          prev: this.last,
          next: null,
          value
        };
        this.items[key] = item;
        if (++this.size === 1) {
          this.first = item;
        } else {
          this.last.next = item;
        }
        this.last = item;
      }
    };
  }
});

// node_modules/@octokit/auth-app/dist-node/index.js
var dist_node_exports = {};
__export(dist_node_exports, {
  createAppAuth: () => createAppAuth,
  createOAuthUserAuth: () => createOAuthUserAuth
});
async function getAppAuthentication({
  appId,
  privateKey,
  timeDifference,
  createJwt
}) {
  try {
    if (createJwt) {
      const { jwt, expiresAt } = await createJwt(appId, timeDifference);
      return {
        type: "app",
        token: jwt,
        appId,
        expiresAt
      };
    }
    const authOptions = {
      id: appId,
      privateKey
    };
    if (timeDifference) {
      Object.assign(authOptions, {
        now: Math.floor(Date.now() / 1e3) + timeDifference
      });
    }
    const appAuthentication = await githubAppJwt(authOptions);
    return {
      type: "app",
      token: appAuthentication.token,
      appId: appAuthentication.appId,
      expiresAt: new Date(appAuthentication.expiration * 1e3).toISOString()
    };
  } catch (error) {
    if (privateKey === "-----BEGIN RSA PRIVATE KEY-----") {
      throw new Error(
        "The 'privateKey` option contains only the first line '-----BEGIN RSA PRIVATE KEY-----'. If you are setting it using a `.env` file, make sure it is set on a single line with newlines replaced by '\n'"
      );
    } else {
      throw error;
    }
  }
}
function getCache() {
  return new LruObject(
    // cache max. 15000 tokens, that will use less than 10mb memory
    15e3,
    // Cache for 1 minute less than GitHub expiry
    1e3 * 60 * 59
  );
}
async function get(cache, options) {
  const cacheKey = optionsToCacheKey(options);
  const result = await cache.get(cacheKey);
  if (!result) {
    return;
  }
  const [
    token,
    createdAt,
    expiresAt,
    repositorySelection,
    permissionsString,
    singleFileName
  ] = result.split("|");
  const permissions = options.permissions || permissionsString.split(/,/).reduce((permissions2, string) => {
    if (/!$/.test(string)) {
      permissions2[string.slice(0, -1)] = "write";
    } else {
      permissions2[string] = "read";
    }
    return permissions2;
  }, {});
  return {
    token,
    createdAt,
    expiresAt,
    permissions,
    repositoryIds: options.repositoryIds,
    repositoryNames: options.repositoryNames,
    singleFileName,
    repositorySelection
  };
}
async function set(cache, options, data) {
  const key = optionsToCacheKey(options);
  const permissionsString = options.permissions ? "" : Object.keys(data.permissions).map(
    (name) => `${name}${data.permissions[name] === "write" ? "!" : ""}`
  ).join(",");
  const value = [
    data.token,
    data.createdAt,
    data.expiresAt,
    data.repositorySelection,
    permissionsString,
    data.singleFileName
  ].join("|");
  await cache.set(key, value);
}
function optionsToCacheKey({
  installationId,
  permissions = {},
  repositoryIds = [],
  repositoryNames = []
}) {
  const permissionsString = Object.keys(permissions).sort().map((name) => permissions[name] === "read" ? name : `${name}!`).join(",");
  const repositoryIdsString = repositoryIds.sort().join(",");
  const repositoryNamesString = repositoryNames.join(",");
  return [
    installationId,
    repositoryIdsString,
    repositoryNamesString,
    permissionsString
  ].filter(Boolean).join("|");
}
function toTokenAuthentication({
  installationId,
  token,
  createdAt,
  expiresAt,
  repositorySelection,
  permissions,
  repositoryIds,
  repositoryNames,
  singleFileName
}) {
  return Object.assign(
    {
      type: "token",
      tokenType: "installation",
      token,
      installationId,
      permissions,
      createdAt,
      expiresAt,
      repositorySelection
    },
    repositoryIds ? { repositoryIds } : null,
    repositoryNames ? { repositoryNames } : null,
    singleFileName ? { singleFileName } : null
  );
}
async function getInstallationAuthentication(state, options, customRequest) {
  const installationId = Number(options.installationId || state.installationId);
  if (!installationId) {
    throw new Error(
      "[@octokit/auth-app] installationId option is required for installation authentication."
    );
  }
  if (options.factory) {
    const { type, factory, oauthApp, ...factoryAuthOptions } = {
      ...state,
      ...options
    };
    return factory(factoryAuthOptions);
  }
  const request2 = customRequest || state.request;
  return getInstallationAuthenticationConcurrently(
    state,
    { ...options, installationId },
    request2
  );
}
function getInstallationAuthenticationConcurrently(state, options, request2) {
  const cacheKey = optionsToCacheKey(options);
  if (pendingPromises.has(cacheKey)) {
    return pendingPromises.get(cacheKey);
  }
  const promise = getInstallationAuthenticationImpl(
    state,
    options,
    request2
  ).finally(() => pendingPromises.delete(cacheKey));
  pendingPromises.set(cacheKey, promise);
  return promise;
}
async function getInstallationAuthenticationImpl(state, options, request2) {
  if (!options.refresh) {
    const result = await get(state.cache, options);
    if (result) {
      const {
        token: token2,
        createdAt: createdAt2,
        expiresAt: expiresAt2,
        permissions: permissions2,
        repositoryIds: repositoryIds2,
        repositoryNames: repositoryNames2,
        singleFileName: singleFileName2,
        repositorySelection: repositorySelection2
      } = result;
      return toTokenAuthentication({
        installationId: options.installationId,
        token: token2,
        createdAt: createdAt2,
        expiresAt: expiresAt2,
        permissions: permissions2,
        repositorySelection: repositorySelection2,
        repositoryIds: repositoryIds2,
        repositoryNames: repositoryNames2,
        singleFileName: singleFileName2
      });
    }
  }
  const appAuthentication = await getAppAuthentication(state);
  const payload = {
    installation_id: options.installationId,
    mediaType: {
      previews: ["machine-man"]
    },
    headers: {
      authorization: `bearer ${appAuthentication.token}`
    }
  };
  if (options.repositoryIds) {
    Object.assign(payload, { repository_ids: options.repositoryIds });
  }
  if (options.repositoryNames) {
    Object.assign(payload, {
      repositories: options.repositoryNames
    });
  }
  if (options.permissions) {
    Object.assign(payload, { permissions: options.permissions });
  }
  const {
    data: {
      token,
      expires_at: expiresAt,
      repositories,
      permissions: permissionsOptional,
      repository_selection: repositorySelectionOptional,
      single_file: singleFileName
    }
  } = await request2(
    "POST /app/installations/{installation_id}/access_tokens",
    payload
  );
  const permissions = permissionsOptional || {};
  const repositorySelection = repositorySelectionOptional || "all";
  const repositoryIds = repositories ? repositories.map((r) => r.id) : void 0;
  const repositoryNames = repositories ? repositories.map((repo) => repo.name) : void 0;
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const cacheOptions = {
    token,
    createdAt,
    expiresAt,
    repositorySelection,
    permissions,
    repositoryIds,
    repositoryNames
  };
  if (singleFileName) {
    Object.assign(payload, { singleFileName });
  }
  await set(state.cache, options, cacheOptions);
  const cacheData = {
    installationId: options.installationId,
    token,
    createdAt,
    expiresAt,
    repositorySelection,
    permissions,
    repositoryIds,
    repositoryNames
  };
  if (singleFileName) {
    Object.assign(cacheData, { singleFileName });
  }
  return toTokenAuthentication(cacheData);
}
async function auth5(state, authOptions) {
  switch (authOptions.type) {
    case "app":
      return getAppAuthentication(state);
    case "oauth-app":
      return state.oauthApp({ type: "oauth-app" });
    case "installation":
      authOptions;
      return getInstallationAuthentication(state, {
        ...authOptions,
        type: "installation"
      });
    case "oauth-user":
      return state.oauthApp(authOptions);
    default:
      throw new Error(`Invalid auth type: ${authOptions.type}`);
  }
}
function routeMatcher(paths) {
  const regexes = paths.map(
    (p) => p.split("/").map((c) => c.startsWith("{") ? "(?:.+?)" : c).join("/")
  );
  const regex = `^(?:${regexes.map((r) => `(?:${r})`).join("|")})$`;
  return new RegExp(regex, "i");
}
function requiresAppAuth(url) {
  return !!url && REGEX.test(url.split("?")[0]);
}
function isNotTimeSkewError(error) {
  return !(error.message.match(
    /'Expiration time' claim \('exp'\) is too far in the future/
  ) || error.message.match(
    /'Expiration time' claim \('exp'\) must be a numeric value representing the future time at which the assertion expires/
  ) || error.message.match(
    /'Issued at' claim \('iat'\) must be an Integer representing the time that the assertion was issued/
  ));
}
async function hook5(state, request2, route, parameters) {
  const endpoint2 = request2.endpoint.merge(route, parameters);
  const url = endpoint2.url;
  if (/\/login\/oauth\/access_token$/.test(url)) {
    return request2(endpoint2);
  }
  if (requiresAppAuth(url.replace(request2.endpoint.DEFAULTS.baseUrl, ""))) {
    const { token: token2 } = await getAppAuthentication(state);
    endpoint2.headers.authorization = `bearer ${token2}`;
    let response;
    try {
      response = await request2(endpoint2);
    } catch (error) {
      if (isNotTimeSkewError(error)) {
        throw error;
      }
      if (typeof error.response.headers.date === "undefined") {
        throw error;
      }
      const diff = Math.floor(
        (Date.parse(error.response.headers.date) - Date.parse((/* @__PURE__ */ new Date()).toString())) / 1e3
      );
      state.log.warn(error.message);
      state.log.warn(
        `[@octokit/auth-app] GitHub API time and system time are different by ${diff} seconds. Retrying request with the difference accounted for.`
      );
      const { token: token3 } = await getAppAuthentication({
        ...state,
        timeDifference: diff
      });
      endpoint2.headers.authorization = `bearer ${token3}`;
      return request2(endpoint2);
    }
    return response;
  }
  if (requiresBasicAuth(url)) {
    const authentication = await state.oauthApp({ type: "oauth-app" });
    endpoint2.headers.authorization = authentication.headers.authorization;
    return request2(endpoint2);
  }
  const { token, createdAt } = await getInstallationAuthentication(
    state,
    // @ts-expect-error TBD
    {},
    request2.defaults({ baseUrl: endpoint2.baseUrl })
  );
  endpoint2.headers.authorization = `token ${token}`;
  return sendRequestWithRetries(
    state,
    request2,
    endpoint2,
    createdAt
  );
}
async function sendRequestWithRetries(state, request2, options, createdAt, retries = 0) {
  const timeSinceTokenCreationInMs = +/* @__PURE__ */ new Date() - +new Date(createdAt);
  try {
    return await request2(options);
  } catch (error) {
    if (error.status !== 401) {
      throw error;
    }
    if (timeSinceTokenCreationInMs >= FIVE_SECONDS_IN_MS) {
      if (retries > 0) {
        error.message = `After ${retries} retries within ${timeSinceTokenCreationInMs / 1e3}s of creating the installation access token, the response remains 401. At this point, the cause may be an authentication problem or a system outage. Please check https://www.githubstatus.com for status information`;
      }
      throw error;
    }
    ++retries;
    const awaitTime = retries * 1e3;
    state.log.warn(
      `[@octokit/auth-app] Retrying after 401 response to account for token replication delay (retry: ${retries}, wait: ${awaitTime / 1e3}s)`
    );
    await new Promise((resolve) => setTimeout(resolve, awaitTime));
    return sendRequestWithRetries(state, request2, options, createdAt, retries);
  }
}
function createAppAuth(options) {
  if (!options.appId) {
    throw new Error("[@octokit/auth-app] appId option is required");
  }
  if (!options.privateKey && !options.createJwt) {
    throw new Error("[@octokit/auth-app] privateKey option is required");
  } else if (options.privateKey && options.createJwt) {
    throw new Error(
      "[@octokit/auth-app] privateKey and createJwt options are mutually exclusive"
    );
  }
  if ("installationId" in options && !options.installationId) {
    throw new Error(
      "[@octokit/auth-app] installationId is set to a falsy value"
    );
  }
  const log = options.log || {};
  if (typeof log.warn !== "function") {
    log.warn = console.warn.bind(console);
  }
  const request2 = options.request || request.defaults({
    headers: {
      "user-agent": `octokit-auth-app.js/${VERSION8} ${getUserAgent()}`
    }
  });
  const state = Object.assign(
    {
      request: request2,
      cache: getCache()
    },
    options,
    options.installationId ? { installationId: Number(options.installationId) } : {},
    {
      log,
      oauthApp: createOAuthAppAuth({
        clientType: "github-app",
        clientId: options.clientId || "",
        clientSecret: options.clientSecret || "",
        request: request2
      })
    }
  );
  return Object.assign(auth5.bind(null, state), {
    hook: hook5.bind(null, state)
  });
}
var pendingPromises, PATHS, REGEX, FIVE_SECONDS_IN_MS, VERSION8;
var init_dist_node = __esm({
  "node_modules/@octokit/auth-app/dist-node/index.js"() {
    "use strict";
    init_universal_user_agent();
    init_dist_bundle2();
    init_dist_bundle8();
    init_universal_github_app_jwt();
    init_toad_cache();
    init_dist_bundle7();
    init_dist_bundle7();
    pendingPromises = /* @__PURE__ */ new Map();
    PATHS = [
      "/app",
      "/app/hook/config",
      "/app/hook/deliveries",
      "/app/hook/deliveries/{delivery_id}",
      "/app/hook/deliveries/{delivery_id}/attempts",
      "/app/installations",
      "/app/installations/{installation_id}",
      "/app/installations/{installation_id}/access_tokens",
      "/app/installations/{installation_id}/suspended",
      "/app/installation-requests",
      "/marketplace_listing/accounts/{account_id}",
      "/marketplace_listing/plan",
      "/marketplace_listing/plans",
      "/marketplace_listing/plans/{plan_id}/accounts",
      "/marketplace_listing/stubbed/accounts/{account_id}",
      "/marketplace_listing/stubbed/plan",
      "/marketplace_listing/stubbed/plans",
      "/marketplace_listing/stubbed/plans/{plan_id}/accounts",
      "/orgs/{org}/installation",
      "/repos/{owner}/{repo}/installation",
      "/users/{username}/installation",
      "/enterprises/{enterprise}/installation"
    ];
    REGEX = routeMatcher(PATHS);
    FIVE_SECONDS_IN_MS = 5 * 1e3;
    VERSION8 = "8.2.0";
  }
});

// src/status.lambda.ts
var status_lambda_exports = {};
__export(status_lambda_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(status_lambda_exports);
var import_client_cloudformation = require("@aws-sdk/client-cloudformation");
var import_client_ec2 = require("@aws-sdk/client-ec2");
var import_client_ecr = require("@aws-sdk/client-ecr");
var import_client_sfn = require("@aws-sdk/client-sfn");

// src/lambda-helpers.ts
var import_client_secrets_manager = require("@aws-sdk/client-secrets-manager");
var sm = new import_client_secrets_manager.SecretsManagerClient();
async function getSecretValue(arn) {
  if (!arn) {
    throw new Error("Missing secret ARN. Check the Lambda configuration and required environment variables.");
  }
  const secret = await sm.send(new import_client_secrets_manager.GetSecretValueCommand({ SecretId: arn }));
  if (!secret.SecretString) {
    throw new Error("Secrets Manager getSecretValue returned no SecretString. This often indicates that the secret was stored as binary data (SecretBinary) instead of a string. Ensure the secret is stored in SecretString or update the code to handle SecretBinary.");
  }
  return secret.SecretString;
}
async function getSecretJsonValue(arn) {
  return JSON.parse(await getSecretValue(arn));
}

// src/lambda-github.ts
var coreModulePromise;
var authAppModulePromise;
function loadOctokitCore() {
  return coreModulePromise ??= Promise.resolve().then(() => (init_dist_src2(), dist_src_exports));
}
function loadOctokitAuthApp() {
  return authAppModulePromise ??= Promise.resolve().then(() => (init_dist_node(), dist_node_exports));
}
function baseUrlFromDomain(domain) {
  if (domain == "github.com") {
    return "https://api.github.com";
  }
  return `https://${domain}/api/v3`;
}

// src/status.lambda.ts
var cfn = new import_client_cloudformation.CloudFormationClient();
var ec2 = new import_client_ec2.EC2Client();
var ecr = new import_client_ecr.ECRClient();
var sf = new import_client_sfn.SFNClient();
function secretArnToUrl(arn) {
  const parts = arn.split(":");
  const region = parts[3];
  const fullName = parts[6];
  const name = fullName.slice(0, fullName.lastIndexOf("-"));
  return `https://${region}.console.aws.amazon.com/secretsmanager/home?region=${region}#!/secret?name=${name}`;
}
function lambdaArnToUrl(arn) {
  const parts = arn.split(":");
  const region = parts[3];
  const name = parts[6];
  return `https://${region}.console.aws.amazon.com/lambda/home?region=${region}#/functions/${name}?tab=monitoring`;
}
function lambdaArnToLogGroup(arn) {
  const parts = arn.split(":");
  const name = parts[6];
  return `/aws/lambda/${name}`;
}
function stepFunctionArnToUrl(arn) {
  const parts = arn.split(":");
  const region = parts[3];
  return `https://${region}.console.aws.amazon.com/states/home?region=${region}#/statemachines/view/${arn}`;
}
async function generateProvidersStatus(stack, logicalId) {
  const resource = await cfn.send(new import_client_cloudformation.DescribeStackResourceCommand({ StackName: stack, LogicalResourceId: logicalId }));
  const providers = JSON.parse(resource.StackResourceDetail?.Metadata ?? "{}").providers;
  if (!providers) {
    return {};
  }
  return Promise.all(providers.map(async (p) => {
    if (p.image?.imageRepository?.match(/[0-9]+\.dkr\.ecr\.[a-z0-9\-]+\.amazonaws\.com\/.+/)) {
      const tags = await ecr.send(new import_client_ecr.DescribeImagesCommand({
        repositoryName: p.image.imageRepository.split("/")[1],
        filter: {
          tagStatus: "TAGGED"
        },
        maxResults: 1
      }));
      if (tags.imageDetails && tags.imageDetails?.length >= 1) {
        p.image.latestImage = {
          tags: tags.imageDetails[0].imageTags,
          digest: tags.imageDetails[0].imageDigest,
          date: tags.imageDetails[0].imagePushedAt
        };
      }
    }
    if (p.ami?.launchTemplate) {
      const versions = await ec2.send(new import_client_ec2.DescribeLaunchTemplateVersionsCommand({
        LaunchTemplateId: p.ami.launchTemplate,
        Versions: ["$Default"]
      }));
      if (versions.LaunchTemplateVersions && versions.LaunchTemplateVersions.length >= 1) {
        p.ami.latestAmi = versions.LaunchTemplateVersions[0].LaunchTemplateData?.ImageId;
      }
    }
    return p;
  }));
}
function safeReturnValue(event, status) {
  if (event.path) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(status)
    };
  }
  return status;
}
async function handler(event) {
  if (!process.env.WEBHOOK_SECRET_ARN || !process.env.GITHUB_SECRET_ARN || !process.env.GITHUB_PRIVATE_KEY_SECRET_ARN || !process.env.LOGICAL_ID || !process.env.WEBHOOK_HANDLER_ARN || !process.env.STEP_FUNCTION_ARN || !process.env.SETUP_SECRET_ARN || !process.env.STACK_NAME) {
    throw new Error("Missing environment variables");
  }
  const [core, authApp] = await Promise.all([
    loadOctokitCore(),
    loadOctokitAuthApp()
  ]);
  const { Octokit: Octokit2 } = core;
  const { createAppAuth: createAppAuth2 } = authApp;
  const status = {
    github: {
      setup: {
        status: "Unknown",
        url: "",
        secretArn: process.env.SETUP_SECRET_ARN,
        secretUrl: secretArnToUrl(process.env.SETUP_SECRET_ARN)
      },
      domain: "Unknown",
      runnerLevel: "Unknown",
      webhook: {
        url: process.env.WEBHOOK_URL,
        status: "Unable to check",
        secretArn: process.env.WEBHOOK_SECRET_ARN,
        secretUrl: secretArnToUrl(process.env.WEBHOOK_SECRET_ARN)
      },
      auth: {
        type: "Unknown",
        status: "Unknown",
        secretArn: process.env.GITHUB_SECRET_ARN,
        secretUrl: secretArnToUrl(process.env.GITHUB_SECRET_ARN),
        privateKeySecretArn: process.env.GITHUB_PRIVATE_KEY_SECRET_ARN,
        privateKeySecretUrl: secretArnToUrl(process.env.GITHUB_PRIVATE_KEY_SECRET_ARN),
        app: {
          id: -1,
          url: "",
          installations: []
        },
        personalAuthToken: ""
      }
    },
    providers: await generateProvidersStatus(process.env.STACK_NAME, process.env.LOGICAL_ID),
    troubleshooting: {
      webhookHandlerArn: process.env.WEBHOOK_HANDLER_ARN,
      webhookHandlerUrl: lambdaArnToUrl(process.env.WEBHOOK_HANDLER_ARN),
      webhookHandlerLogGroup: lambdaArnToLogGroup(process.env.WEBHOOK_HANDLER_ARN),
      stepFunctionArn: process.env.STEP_FUNCTION_ARN,
      stepFunctionUrl: stepFunctionArnToUrl(process.env.STEP_FUNCTION_ARN),
      stepFunctionLogGroup: process.env.STEP_FUNCTION_LOG_GROUP,
      recentRuns: []
    }
  };
  if (process.env.SETUP_FUNCTION_URL) {
    const setupToken = (await getSecretJsonValue(process.env.SETUP_SECRET_ARN)).token;
    if (setupToken) {
      status.github.setup.status = "Pending";
      status.github.setup.url = `${process.env.SETUP_FUNCTION_URL}?token=${setupToken}`;
    } else {
      status.github.setup.status = "Complete";
    }
  } else {
    status.github.setup.status = "Disabled";
  }
  try {
    const executions = await sf.send(new import_client_sfn.ListExecutionsCommand({
      stateMachineArn: process.env.STEP_FUNCTION_ARN,
      maxResults: 10
    }));
    for (const execution of executions.executions ?? []) {
      const executionDetails = await sf.send(new import_client_sfn.DescribeExecutionCommand({
        executionArn: execution.executionArn
      }));
      const input = JSON.parse(executionDetails.input || "{}");
      status.troubleshooting.recentRuns.push({
        executionArn: execution.executionArn,
        status: execution.status ?? "<unknown>",
        owner: input.owner,
        repo: input.repo,
        jobId: input.jobId
      });
    }
  } catch (e) {
    status.troubleshooting.recentRuns.push({ status: `Error getting executions: ${e}` });
  }
  let githubSecrets;
  try {
    githubSecrets = await getSecretJsonValue(process.env.GITHUB_SECRET_ARN);
  } catch (e) {
    status.github.auth.status = `Unable to read secret: ${e}`;
    return safeReturnValue(event, status);
  }
  let privateKey;
  try {
    privateKey = await getSecretValue(process.env.GITHUB_PRIVATE_KEY_SECRET_ARN);
  } catch (e) {
    status.github.auth.status = `Unable to read private key secret: ${e}`;
    return safeReturnValue(event, status);
  }
  let baseUrl = baseUrlFromDomain(githubSecrets.domain);
  status.github.domain = githubSecrets.domain;
  status.github.runnerLevel = githubSecrets.runnerLevel ?? "repo";
  if (githubSecrets.personalAuthToken) {
    status.github.auth.type = "Personal Access Token";
    status.github.auth.personalAuthToken = "*redacted*";
    let octokit;
    try {
      octokit = new Octokit2({ baseUrl, auth: githubSecrets.personalAuthToken });
    } catch (e) {
      status.github.auth.status = `Unable to authenticate using personal auth token: ${e}`;
      return safeReturnValue(event, status);
    }
    try {
      const user = await octokit.request("GET /user");
      status.github.auth.personalAuthToken = `username: ${user.data.login}`;
    } catch (e) {
      status.github.auth.status = `Unable to call /user with personal auth token: ${e}`;
      return safeReturnValue(event, status);
    }
    status.github.auth.status = "OK";
    status.github.webhook.status = "Unable to verify automatically";
  } else {
    status.github.auth.type = "GitHub App";
    status.github.auth.app.id = githubSecrets.appId;
    let appOctokit;
    try {
      appOctokit = new Octokit2({
        baseUrl,
        authStrategy: createAppAuth2,
        auth: {
          appId: githubSecrets.appId,
          privateKey
        }
      });
    } catch (e) {
      status.github.auth.status = `Unable to authenticate app: ${e}`;
      return safeReturnValue(event, status);
    }
    try {
      const appRes = await appOctokit.request("GET /app");
      const app = appRes.data;
      if (!app) {
        status.github.auth.status = `Unable to get app: ${appRes}`;
        return safeReturnValue(event, status);
      }
      status.github.auth.app.url = app.html_url;
    } catch (e) {
      status.github.auth.status = `Unable to get app details: ${e}`;
      return safeReturnValue(event, status);
    }
    try {
      const installations = (await appOctokit.request("GET /app/installations")).data;
      for (const installation of installations) {
        let installationDetails = {
          id: installation.id,
          url: installation.html_url,
          status: "Unable to query",
          repositories: []
        };
        let token;
        try {
          token = (await appOctokit.auth({
            type: "installation",
            installationId: installation.id
          })).token;
        } catch (e) {
          installationDetails.status = `Unable to authenticate app installation: ${e}`;
          continue;
        }
        let octokit;
        try {
          octokit = new Octokit2({ baseUrl, auth: token });
        } catch (e) {
          installationDetails.status = `Unable to authenticate using app: ${e}`;
          continue;
        }
        try {
          const repositories = (await octokit.request("GET /installation/repositories")).data.repositories;
          for (const repo of repositories) {
            installationDetails.repositories.push(repo.full_name);
          }
        } catch (e) {
          installationDetails.status = `Unable to authenticate using installation token: ${e}`;
          continue;
        }
        installationDetails.status = "OK";
        status.github.auth.app.installations.push(installationDetails);
      }
    } catch (e) {
      status.github.auth.status = "Unable to list app installations";
      return safeReturnValue(event, status);
    }
    status.github.auth.status = "OK";
    try {
      const response = await appOctokit.request("GET /app/hook/config", {});
      if (response.data.url !== process.env.WEBHOOK_URL) {
        status.github.webhook.status = "GitHub has wrong webhook URL configured";
      } else {
        status.github.webhook.status = "OK (note that secret cannot be checked automatically)";
      }
    } catch (e) {
      status.github.webhook.status = `Unable to check app configuration: ${e}`;
      return safeReturnValue(event, status);
    }
  }
  return safeReturnValue(event, status);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
/*! Bundled license information:

@octokit/request-error/dist-src/index.js:
  (* v8 ignore else -- @preserve -- Bug with vitest coverage where it sees an else branch that doesn't exist *)

@octokit/request/dist-bundle/index.js:
  (* v8 ignore next -- @preserve *)
  (* v8 ignore else -- @preserve *)

toad-cache/dist/toad-cache.mjs:
  (**
   * toad-cache
   *
   * @copyright 2024 Igor Savin <kibertoad@gmail.com>
   * @license MIT
   * @version 3.7.0
   *)
*/
