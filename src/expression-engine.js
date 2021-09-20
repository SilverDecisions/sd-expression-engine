import {log, Utils} from "sd-utils";
import * as math from "./mathjs";
import * as sdRandom from "sd-random";

//Import random functions from sd-random to math.js
sdRandom.functionNameList.forEach(fnName => {
    let importFn = {};
    importFn[fnName] = sdRandom[fnName];
    try {
        math.import(importFn);
    } catch (e) {
        log.error(e)
    }
});


export class ExpressionEngine {

    constructor() {

    }

    eval(expr, asNumber = true, scope) {
        return ExpressionEngine.eval(expr, asNumber, scope);
    }

    static eval(expr, asNumber = true, scope) {
        log.trace('eval: ' + expr);
        expr += "";
        expr = expr.trim();
        if (asNumber) {
            try {
                return ExpressionEngine.toNumber(expr);
            } catch (e) {
                //   Left empty intentionally
            }
        }

        let ev = math.evaluate(expr + "", scope || {});

        if (!asNumber) {
            return ev;
        }
        return ExpressionEngine.toNumber(ev);
    }

    static isHash(expr) {
        return expr && Utils.isString(expr) && expr.trim() === '#'
    }

    static hasAssignmentExpression(expr) {
        return Utils.isString(expr) && expr.indexOf('=') !== -1
    }

    static add(a, b) {
        return math.add(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b));
    }

    static subtract(a, b) {
        return math.subtract(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b));
    }

    static divide(a, b) {
        return math.divide(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b));
    }

    static multiply(a, b) {
        return math.multiply(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b));
    }

    static round(a, places) {
        return ExpressionEngine.toNumber(a).round(places)
    }

    static toNumber(a) {
        let parsed = parseFloat(a);
        if (parsed === Infinity || parsed === -Infinity) {
            return parsed;
        }

        return math.fraction(a);
    }

    static max() {
        return math.max(...arguments);
    }

    static min() {
        return math.min(...arguments);
    }

    static mad() {
        return math.mad(...arguments);
    }

    static mean() {
        return math.mean(...arguments);
    }

    static median() {
        return math.median(...arguments);
    }

    static std() {
        return math.std(...arguments);
    }


    static compare(a, b) {
        a = ExpressionEngine.toNumber(a);
        b = ExpressionEngine.toNumber(b);
        if (a !== b) {
            if (a === -Infinity) {
                return -1
            }
            if (a === Infinity) {
                return 1
            }
            if (b === -Infinity) {
                return 1
            }
            if (b === Infinity) {
                return -1
            }
        } else {
            return 0;
        }

        return math.compare(a, b)
    }


    validate(expr, scope, compileOnly = true) {
        if (!scope) {
            scope = {};
        }
        return ExpressionEngine.validate(expr, scope, compileOnly);
    }

    static validate(expr, scope, compileOnly = true) {
        if (expr === null || expr === undefined) {
            return false;
        }

        try {
            expr += "";
            expr = expr.trim();
            const c = math.compile(expr);

            if (compileOnly) {
                return true;
            }

            const e = c.evaluate(scope);
            return Utils.isNumeric(e);
        } catch (e) {
            return false;
        }
    }

    static isExpressionObject(v) {
        return v && !!v.mathjs;
    }

    serialize(v) {
        return ExpressionEngine.toNumber(v).toFraction(true);
    }

    getJsonReviver() {
        return math.reviver;
    }

    getJsonReplacer() {
        const self = this;
        return function (k, v) {
            if (v !== null && v !== undefined && ExpressionEngine.isExpressionObject(v)) {
                try {
                    return self.serialize(v);
                } catch (e) {
                    return v;
                }
            }
            return v;
        }
    }

    static toFloat(number) {
        return math.number(number);
    }

    static format(val) {
        return math.format(val);
    }

    static randomMenuList = sdRandom.menuList.slice();
}
