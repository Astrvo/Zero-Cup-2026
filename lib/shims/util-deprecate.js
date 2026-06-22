module.exports = function deprecate(fn, message) {
    let warned = false;

    return function deprecated(...args) {
        if (!warned) {
            if (process.env.NO_DEPRECATION) {
                return fn.apply(this, args);
            }

            if (process.env.TRACE_DEPRECATION) {
                console.trace(message);
            } else if (!process.env.NO_DEPRECATION) {
                console.warn(message);
            }

            warned = true;
        }

        return fn.apply(this, args);
    };
};
