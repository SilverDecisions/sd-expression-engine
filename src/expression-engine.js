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
// values of the probabilistic sensitivity analysis, grows without limit, gets
// slow and its JS number (valueOf) becomes NaN. With Math.js 9 (fraction.js 4,
// JS numbers) Fractions stayed within the safe integer range. The arithmetic
// helpers therefore round a result whose denominator exceeds MAX_DENOMINATOR to
// the closest fraction with a denominator up to MAX_DENOMINATOR.
const MAX_DENOMINATOR = BigInt(Number.MAX_SAFE_INTEGER);
const ZERO = BigInt(0);
const ONE = BigInt(1);

function abs(v) {
    return v < ZERO ? -v : v;
}

// best rational approximation with a bounded denominator (continued fractions)
function limitDenominator(f) {
    if (!math.isFraction(f) || f.d <= MAX_DENOMINATOR) {
        return f;
    }
    let p0 = ZERO, q0 = ONE, p1 = ONE, q1 = ZERO;
    let n = f.n, d = f.d;
    while (true) {
        const a = n / d;
        const q2 = q0 + a * q1;
        if (q2 > MAX_DENOMINATOR) {
            break;
        }
        const p2 = p0 + a * p1;
        p0 = p1;
        q0 = q1;
        p1 = p2;
        q1 = q2;
        const r = n - a * d;
        n = d;
        d = r;
    }
    const k = (MAX_DENOMINATOR - q0) / q1;
    const p = p0 + k * p1;
    const q = q0 + k * q1;
    // |p1/q1 - x| <= |p/q - x|, cross-multiplied
    const closer = abs(p1 * f.d - f.n * q1) * q <= abs(p * f.d - f.n * q) * q1;
    return closer ? new math.Fraction(f.s * p1, q1) : new math.Fraction(f.s * p, q);
}

// JS number of a Fraction; fraction.js 5 valueOf() is NaN when numerator and
// denominator are both beyond the double range
function fractionToFloat(f) {
    const v = f.valueOf();
    if (!isNaN(v)) {
        return v;
    }
    const bits = Math.max(f.n.toString(2).length, f.d.toString(2).length) - 1000;
    const shift = BigInt(bits > 0 ? bits : 0);
    return Number(f.s * (f.n >> shift)) / Number(f.d >> shift);
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
        return limitDenominator(math.add(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b)));
    }

    static subtract(a, b) {
        return limitDenominator(math.subtract(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b)));
    }

    static divide(a, b) {
        return limitDenominator(math.divide(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b)));
    }

    static multiply(a, b) {
        return limitDenominator(math.multiply(ExpressionEngine.toNumber(a), ExpressionEngine.toNumber(b)));
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
