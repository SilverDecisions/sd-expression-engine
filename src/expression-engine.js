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

// Math.js 14+ (fraction.js 5) computes Fractions exactly with bigint numerators
// and denominators: a sum of many evaluated (float) values, e.g. the expected
// values of the probabilistic sensitivity analysis, grows to thousands of digits,
// gets slow and its JS number (valueOf) becomes NaN. With Math.js 9 (fraction.js
// 4) numerator and denominator were doubles: about 16 significant digits at any
// magnitude. The arithmetic helpers therefore keep a result exact while its
// numerator and denominator have at most MAX_BITS bits, and otherwise replace it
// with the first continued-fraction convergent within a relative error of
// 2^-RELATIVE_BITS (about 5e-20). Small values keep their magnitude; results
// are exact up to 64-bit numerators and denominators (Math.js 9: 53 bits) and
// otherwise about 2000 times more precise than a double. The bounds keep the
// cost of long sums close to Math.js 9.
const MAX_BITS = 64;
const RELATIVE_BITS = BigInt(64);
const ZERO = BigInt(0);
const ONE = BigInt(1);

function abs(v) {
    return v < ZERO ? -v : v;
}

function bitLength(v) {
    return v === ZERO ? 0 : abs(v).toString(2).length;
}

function roundFraction(f) {
    if (!math.isFraction(f) || (bitLength(f.n) <= MAX_BITS && bitLength(f.d) <= MAX_BITS)) {
        return f;
    }
    // f.n > 0 here (zero is 0/1); convergents p1/q1 of f.n/f.d
    const x = f.n, y = f.d;
    let p0 = ZERO, q0 = ONE, p1 = ONE, q1 = ZERO;
    let n = x, d = y;
    while (d !== ZERO) {
        const a = n / d;
        const p2 = a * p1 + p0;
        const q2 = a * q1 + q0;
        p0 = p1;
        q0 = q1;
        p1 = p2;
        q1 = q2;
        const r = n - a * d;
        n = d;
        d = r;
        // |p1/q1 - x/y| <= 2^-RELATIVE_BITS * x/y, cross-multiplied
        if ((abs(p1 * y - x * q1) << RELATIVE_BITS) <= x * q1) {
            break;
        }
    }
    return new math.Fraction(f.s * p1, q1);
}

// JS number of a Fraction. fraction.js 5 valueOf() is Number(n) / Number(d),
// which is Infinity or NaN when n or d is beyond the double range (about 2^1024)
// although the quotient is not; such Fractions are divided with bigint to 64
// significant bits and scaled by a power of two.
function fractionToFloat(f) {
    const nBits = bitLength(f.n);
    const dBits = bitLength(f.d);
    if (nBits <= 1000 && dBits <= 1000) {
        return f.valueOf();
    }
    if (f.n === ZERO) {
        return 0;
    }
    // q = floor(n * 2^-e / d) has 64 or 65 bits
    const e = nBits - dBits - 64;
    const q = e >= 0 ? f.n / (f.d << BigInt(e)) : (f.n << BigInt(-e)) / f.d;
    let v = Number(q);
    let k = e;
    while (k !== 0) {
        const step = Math.max(-1000, Math.min(1000, k));
        v *= Math.pow(2, step);
        k -= step;
    }
    return f.s < ZERO ? -v : v;
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
        return roundFraction(math.add(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b)));
    }

    static subtract(a, b) {
        return roundFraction(math.subtract(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b)));
    }

    static divide(a, b) {
        return roundFraction(math.divide(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b)));
    }

    static multiply(a, b) {
        return roundFraction(math.multiply(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b)));
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
