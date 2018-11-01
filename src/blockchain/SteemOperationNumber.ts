import { UnifiedSteemTransaction } from "./UnifiedSteemTransaction";

export class SteemOperationNumber {
    public blockNum: number;
    public transactionNum: number;
    public operationNum: number;

    public static FUTURE: SteemOperationNumber = new SteemOperationNumber(Infinity, Infinity, Infinity);
    public static NOW: SteemOperationNumber = SteemOperationNumber.FUTURE;
    public static NEVER: SteemOperationNumber = new SteemOperationNumber(-1, -1, -1);

    constructor(blockNum: number, transactionNum: number, operationNum: number = 0) {
        this.blockNum = blockNum;
        this.transactionNum = transactionNum;
        this.operationNum = operationNum;
    }

    public isGreaterThan(tn: SteemOperationNumber): boolean {
        if (this.blockNum > tn.blockNum) return true;
        else if (this.blockNum == tn.blockNum && this.transactionNum > tn.transactionNum) return true;
        else if (this.blockNum == tn.blockNum && this.transactionNum == tn.transactionNum) return this.operationNum > tn.operationNum;
        else return false;
    }

    public isGreaterOrEqual(tn: SteemOperationNumber): boolean {
        if (this.blockNum > tn.blockNum) return true;
        else if (this.blockNum == tn.blockNum && this.transactionNum > tn.transactionNum) return true;
        else if (this.blockNum == tn.blockNum && this.transactionNum == tn.transactionNum) return this.operationNum >= tn.operationNum;
        else return false;
    }

    public isLesserThan(tn: SteemOperationNumber): boolean {
        if (this.blockNum < tn.blockNum) return true;
        else if (this.blockNum == tn.blockNum && this.transactionNum < tn.transactionNum) return true;
        else if (this.blockNum == tn.blockNum && this.transactionNum == tn.transactionNum) return this.operationNum < tn.operationNum;
        else return false;
    }

    /**
     * There is a bug in account_history api: op_in_trx is always zero in returned operations.
     * This prevents proper comparison of SteemOperationNumbers. Thuswe have to use the following hack in some places.
     * Issue: https://github.com/steemit/steem/issues/2272 It is solved, but in api.steemit.com endpoint the bug still exists.
     * TODO: Stop using this function when the bug is solved. There is a separate function, because it would be
     * dangerous (easy to forget about) to solve the bug implicitly.
     */
    public isLesserThan_solveOpInTrxBug(tn: SteemOperationNumber): boolean {
        if (this.blockNum < tn.blockNum) return true;
        else if (this.blockNum == tn.blockNum && this.transactionNum <= (tn.transactionNum - 1)) return true;
        else return false;
    }

    public isLesserOrEqual(tn: SteemOperationNumber): boolean {
        if (this.blockNum < tn.blockNum) return true;
        else if (this.blockNum == tn.blockNum && this.transactionNum < tn.transactionNum) return true;
        else if (this.blockNum == tn.blockNum && this.transactionNum == tn.transactionNum) return this.operationNum <= tn.operationNum;
        else return false;
    }

    public isEqual(tn: SteemOperationNumber): boolean {
        return this.blockNum == tn.blockNum && this.transactionNum == tn.transactionNum && this.operationNum == tn.operationNum;
    }

    /**
     * There is a bug in account_history api: op_in_trx is always zero in returned operations.
     * This prevents proper comparison of SteemOperationNumbers. Thuswe have to use the following hack in some places.
     * Issue: https://github.com/steemit/steem/issues/2272 It is solved, but in api.steemit.com endpoint the bug still exists.
     * TODO: Stop using this function when the bug is solved. There is a separate function, because it would be
     * dangerous (easy to forget about) to solve the bug implicitly.
     */
    public isEqual_solveOpInTrxBug(tn: SteemOperationNumber): boolean {
        return this.blockNum == tn.blockNum && this.transactionNum == tn.transactionNum;
    }

    public addTransactions(txNum: number): SteemOperationNumber {
        return new SteemOperationNumber(this.blockNum, this.transactionNum + txNum, this.operationNum);
    }

    public toString(): string {
        return "[b=" + this.blockNum + ", tx=" + this.transactionNum + ", op=" + this.operationNum + "]";
    }

    public static fromTransaction(op: UnifiedSteemTransaction, operationNum: number = 0): SteemOperationNumber {
        return new SteemOperationNumber(op.block_num, op.transaction_num, operationNum);
    }

    public static compare(sonA: SteemOperationNumber, sonB: SteemOperationNumber): number {
        if (sonA.blockNum === sonB.blockNum) {
            if (sonA.transactionNum === sonB.transactionNum)
                return sonA.operationNum - sonB.operationNum;
            else
                return sonA.transactionNum - sonB.transactionNum;
        }
        else
            return sonA.blockNum - sonB.blockNum;
    }

    public clone(): SteemOperationNumber {
        return new SteemOperationNumber(this.blockNum, this.transactionNum, this.operationNum);
    }
}