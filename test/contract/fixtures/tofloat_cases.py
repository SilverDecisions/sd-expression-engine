#!/usr/bin/env python3
# Generates tofloat_cases.json: Fractions n/d (hex integers) and the double nearest
# to n/d with ties to even (IEEE 754 round-to-nearest), as reference for
# ExpressionEngine.toFloat. The reference is Python's float(Fraction(n, d)), an
# integer true division that CPython rounds correctly; OverflowError means the
# rounded value is beyond the double range (+-Infinity).
#   python3 -I test/contract/fixtures/tofloat_cases.py > test/contract/fixtures/tofloat_cases.json
import json
import random
import struct
from fractions import Fraction


def expected(f):
    try:
        x = float(f)
    except OverflowError:
        return 'Infinity' if f > 0 else '-Infinity'
    return struct.pack('>d', x).hex()


def case(n, d, note):
    f = Fraction(n, d)
    return {'n': hex(n), 'd': hex(d), 'expected': expected(f), 'note': note}


cases = []
M = 2 ** 53
# ties and both sides of the midpoint between neighbouring doubles, with
# numerators and denominators beyond 53 bits (bigint path)
for k in (200, 1000, 1100):
    D = 2 ** k
    half = 2 ** (k - 53)        # half an ulp of 1
    cases.append(case(D + half, D, '1 + half ulp: tie, to even (1)'))
    cases.append(case(D + half + 1, D, '1 + half ulp + tiny: up'))
    cases.append(case(D + half - 1, D, '1 + half ulp - tiny: down'))
    cases.append(case(D + 3 * half, D, '1 + 3 half ulps: tie, to even (1 + 2 ulps)'))
    cases.append(case(D + 3 * half - 1, D, '1 + 3 half ulps - tiny: down (1 + 1 ulp)'))
for k in (60, 300):
    t = 3 ** k                  # non-dyadic denominators
    cases.append(case((M + 1) * t, M * t, 'tie (2^53+1)/2^53 scaled by 3^k, to even'))
    cases.append(case((M + 1) * t + 1, M * t, 'above the tie, scaled'))
    cases.append(case((M + 1) * t - 1, M * t, 'below the tie, scaled'))
cases.append(case(2 ** 200 + 2 ** 147 + 1, 2 ** 200, '(2^200 + 2^147 + 1) / 2^200 (review example)'))
cases.append(case(10 ** 310 + 1, 1009, '(10^310 + 1) / 1009'))
cases.append(case(2 ** 1200 + 1, 2 ** 2200 + 1, '(2^1200 + 1) / (2^2200 + 1)'))
# subnormal range: quantum 2^-1074
for num, den, note in [
    (1, 2 ** 1075, 'half of the smallest subnormal: tie, to even (0)'),
    (1, 2 ** 1075 - 1, 'just above half of the smallest subnormal: up'),
    (3, 2 ** 1075, '1.5 x smallest subnormal: tie, to even (2 x)'),
    (5, 2 ** 1076, '1.25 x smallest subnormal: down'),
    (2 ** 52 - 1, 2 ** 1074, 'largest subnormal'),
    ((2 ** 53 - 1) * 3, 2 ** 1075 * 3, 'between the largest subnormal and 2^-1022: tie, to even (2^-1022)'),
    (1, 3 * 2 ** 1022, '1/3 of 2^-1022 (subnormal, non-dyadic)'),
    (1, 10 ** 330, '1e-330 (subnormal)'),
    (1, 10 ** 400, '1e-400 (below the range: 0)'),
]:
    cases.append(case(num, den, note))
# overflow boundary: MAX = (2^53 - 1) 2^971, the midpoint to 2^1024 is (2^54 - 1) 2^970
mid = (2 ** 54 - 1) * 2 ** 970
cases.append(case(mid, 1, 'midpoint MAX / 2^1024: tie, to even (Infinity)'))
cases.append(case(3 * mid - 1, 3, 'just below the midpoint: MAX'))
cases.append(case(3 * mid + 1, 3, 'just above the midpoint: Infinity'))
cases.append(case(-(3 * mid - 1), 3, 'negative, just below the midpoint: -MAX'))
cases.append(case(10 ** 400 + 1, 3, 'far beyond the range: Infinity'))
# random large pairs (seeded), quotients across the whole range
rnd = random.Random(20261101)
for i in range(150):
    n = rnd.getrandbits(rnd.randint(1, 1200)) | 1
    d = rnd.getrandbits(rnd.randint(1, 1200)) | 1
    if rnd.random() < 0.3:
        n = -n
    cases.append(case(n, d, 'random'))

print(json.dumps({'generator': 'test/contract/fixtures/tofloat_cases.py', 'cases': cases}, indent=1))
