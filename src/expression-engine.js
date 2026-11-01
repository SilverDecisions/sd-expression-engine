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

// Fractions of Math.js 14+ (fraction.js 5) hold bigint numerators and
// denominators. fraction.js 5 valueOf() is Number(n) / Number(d): it rounds n and
// d first and gives Infinity or NaN when they are beyond the double range,
// although the quotient may not be. toFloat therefore converts with bigint:
// the result is the double nearest to n / d, ties to even (IEEE 754
// round-to-nearest), including subnormal results and overflow to +-Infinity.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

function bitLength(v) {
    return v === ZERO ? 0 : (v < ZERO ? -v : v).toString(2).length;
}

// x * 2^k without intermediate overflow or underflow (k may exceed the exponent range)
function scale(x, k) {
    while (k !== 0) {
        const step = Math.max(-1000, Math.min(1000, k));
        x *= Math.pow(2, step);
        k -= step;
    }
    return x;
}

function fractionToFloat(f) {
    const n = f.n < ZERO ? -f.n : f.n;
    const d = f.d;
    const negative = f.s < ZERO;
    let v;
    if (n === ZERO) {
        v = 0;
    } else if (bitLength(n) <= 53 && bitLength(d) <= 53) {
        // exact integers, one correctly rounded division
        v = Number(n) / Number(d);
    } else if ((n << BigInt(1022)) < d) {
        // subnormal (below 2^-1022): round n / d * 2^1074 to an integer, ties to even
        const t = n << BigInt(1074);
        let q = t / d;
        const r2 = (t - q * d) * TWO;
        if (r2 > d || (r2 === d && (q & ONE) === ONE)) {
            q += ONE;
        }
        v = Number(q) * Math.pow(2, -1074);
    } else {
        // q = floor(n / d * 2^k) with at least 55 bits; a set lowest bit for a
        // non-zero remainder (sticky bit) lets Number(q) round correctly to 53 bits
        const k = 55 - (bitLength(n) - bitLength(d));
        let q = k >= 0 ? (n << BigInt(k)) / d : n / (d << BigInt(-k));
        const exact = k >= 0 ? q * d === n << BigInt(k) : q * (d << BigInt(-k)) === n;
        if (!exact) {
            q |= ONE;
        }
        v = scale(Number(q), -k);
    }
    return negative ? -v : v;
}


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
        if (math.isUnit(a)) {
            // Math.js 14+ converts the value of a Unit; a payoff or probability is a number
            throw new TypeError('Unexpected type of argument in function fraction (actual: Unit)');
        }
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

    static print(){
        return math.print.apply(math, arguments)
    }

    print() {
        return ExpressionEngine.print.apply(this, arguments);
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
        if (math.isFraction(number)) {
            return fractionToFloat(number);
        }
        return math.number(number);
    }

    static format() {
        return math.format.apply(math, arguments);
    }

    format() {
        return ExpressionEngine.format.apply(this, arguments);
    }

    static randomMenuList = sdRandom.menuList.slice();
}
