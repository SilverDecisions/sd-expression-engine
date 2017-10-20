import {ExpressionEngine} from '../../src/expression-engine'


let expressions = [
    ["2+2", 4],
    ["2*5", 10],
    ["10/2", 5]
];



describe("ExpressionEngine", ()=>{
    let ep;
    beforeEach(()=>{
        ep = new ExpressionEngine();
        ep.setScope({})
    });


    it("should eval expressions correctly", ()=>{
        expressions.forEach(expr=>{
            expect(ep.eval(expr[0]).valueOf()).toEqual(expr[1]);
        })
    });

    it("static eval fn should eval expressions correctly", ()=>{
        expressions.forEach(expr=>{
            expect(ExpressionEngine.eval(expr[0]).valueOf()).toEqual(expr[1]);
        })
    });

    it("should compare correctly", ()=>{

        expect(ExpressionEngine.compare(1, 5)<0).toBeTruthy();
        expect(ExpressionEngine.compare(-Infinity, 5)<0).toBeTruthy();
        expect(ExpressionEngine.compare(Infinity, 5)>0).toBeTruthy();
        expect(ExpressionEngine.compare(2, Infinity)<0).toBeTruthy();
        expect(ExpressionEngine.compare(2, -Infinity)>0).toBeTruthy();
        expect(ExpressionEngine.compare(5, 5)==0).toBeTruthy();
        expect(ExpressionEngine.compare(Infinity, Infinity)==0).toBeTruthy();

    });

    it("should validate correctly", ()=>{

        expect(ep.validate("5")).toBeTruthy();
        expect(ep.validate("5 /")).toBeFalsy();
        expect(ep.validate(null)).toBeFalsy();

        expect(ep.validate("5 + d", {}, false)).toBeFalsy();
        expect(ep.validate("5 + d", {d:1}, false)).toBeTruthy();

    });

    it("static functions should work", ()=>{
        expect(ExpressionEngine.add(2,2).valueOf()).toEqual(4);
        expect(ExpressionEngine.subtract(4,2).valueOf()).toEqual(2);
        expect(ExpressionEngine.divide(4,2).valueOf()).toEqual(2);
        expect(ExpressionEngine.multiply(2,3).valueOf()).toEqual(6);
        expect(ExpressionEngine.round(2.5555,2).valueOf()).toEqual(2.56);
        expect(ExpressionEngine.max(2,3).valueOf()).toEqual(3);
        expect(ExpressionEngine.min(2,3).valueOf()).toEqual(2);
        expect(ExpressionEngine.mad(10, 20, 30).valueOf()).toEqual(10);
        expect(ExpressionEngine.mean(10, 20, 30).valueOf()).toEqual(20);
        expect(ExpressionEngine.median(10, 20, 30, 40).valueOf()).toEqual(25);
        expect(ExpressionEngine.std(2, 4, 6).valueOf()).toEqual(2);
        expect(ExpressionEngine.format(ExpressionEngine.toNumber("10/5"))).toEqual("2/1");
    });


    it("should detect assignment expression", ()=>{
        expect(ExpressionEngine.hasAssignmentExpression("a = 5")).toBeTruthy();
        expect(ExpressionEngine.hasAssignmentExpression("a + 5")).toBeFalsy();
    })

    it("should detect hash", ()=>{
        expect(ExpressionEngine.isHash(" # ")).toBeTruthy();
        expect(ExpressionEngine.isHash("a + 5")).toBeFalsy();
    })


    it("should return JsonReplacer", ()=>{
        let jsonReplacer = ep.getJsonReplacer();
        expect(jsonReplacer).toBeTruthy();
        expect(jsonReplacer("k", "5")).toEqual("5");
    })

    it("should return getJsonReviver", ()=>{
        let jsonReviver = ep.getJsonReviver();
        expect(jsonReviver).toBeTruthy();
    });

    it("should serialize number correctly", ()=>{
        expect(ep.serialize(ExpressionEngine.toNumber("0.2"))).toEqual("1/5");
    });

    it("should convert to Float", ()=>{
        expect(ExpressionEngine.toFloat(ExpressionEngine.toNumber("1/5"))).toEqual(0.2);
    });

});
