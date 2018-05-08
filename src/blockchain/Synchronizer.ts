import { Promise } from "bluebird";
import { AccountHistorySupplier, SmartvotesFilter, OperationNumberFilter, SimpleTaker,
    ToSmartvotesOperationTransformer, SmartvotesOperationTypeFilter,
    ChainableLimiter, BiTransformer, OperationTypeFilter, OperationNumberLimiter } from "../chainable/_exports";
import { smartvotes_operation, smartvotes_command_set_rules, smartvotes_voteorder, smartvotes_ruleset } from "../schema/smartvotes.schema";
import { RawOperation } from "../blockchain/blockchain-operations-types";
import { _objectAssign } from "../util/util";
import { SteemOperationNumber } from "../blockchain/SteemOperationNumber";
import { RulesValidator } from "../validation/RulesValidator";

interface VoteConfirmedAtMoment {
    opNum: SteemOperationNumber;
    voteorderTransactionId: string;
}

interface RulesetAtMoment {
    opNum: SteemOperationNumber;
    ruleset: smartvotes_ruleset;
    validityUntil: SteemOperationNumber;
}

interface VoteorderAtMoment {
    transactionId: string;
    opNum: SteemOperationNumber;
    voter: string;
    voteorder: smartvotes_voteorder;
}

/*interface BeforeSyncData1 {
    rulesets: RulesetAtMoment [];
    confirmedVotes: VoteConfirmedAtMoment [];
}

interface BeforeSyncData2 extends BeforeSyncData1 {
    voteorders: VoteorderAtMoment [];
}*/

export class Synchronizer {
    private steem: any;
    private username: string;
    private postingWif: string;
    private proggressCallback: (msg: string, proggress: number) => void = (msg, proggress) => {};

    constructor(steem: any, username: string, postingWif: string) {
        this.steem = steem;
        this.username = username;
        this.postingWif = postingWif;
    }

    public withProggressCallback(proggressCallback: (msg: string, proggress: number) => void) {
        this.proggressCallback = proggressCallback;
    }

    public synchronize = (callback: (error: Error | undefined) => void, ): void => {
        this.proggressCallback("Loading rulesets since last synchronized voteorder", 0);

        this.loadUnsynchronizedOperations()
        .then((input: any) => { this.proggressCallback("Loading new voteorders from voters you delegated to", 0.2); return input; })
        .then(this.loadVoteorders)
        .then((input: any) => { this.proggressCallback("Loaded all voteorders, validating...", 0.6); return input; })
        .then(this.removeAlreadyConfirmedVotes)
        .then(this.sortVoteordersFromOldestToNewest)
        .then(this.removeDuplicateVoteorders)
        .then(this.validateAndSend)
        .then((input: any) => { callback(undefined); })
        .catch((error: Error) => callback(error));
    }

    private loadUnsynchronizedOperations = (): Promise<{rulesets: RulesetAtMoment [], confirmedVotes: VoteConfirmedAtMoment []}> => {
        return new Promise((resolve, reject) => {
            let rulesets: RulesetAtMoment [] = [];
            const confirmedVotes: VoteConfirmedAtMoment [] = [];

            let foundVoteConfirmation = false;
            new AccountHistorySupplier(this.steem, this.username)
            .branch((historySupplier) => {
                historySupplier
                .chain(new SmartvotesFilter())
                .chain(new BiTransformer())
                .chain(new SimpleTaker((item: {rawOp: RawOperation, op: smartvotes_operation}): boolean => {
                    if (item.op.name === "confirm_vote") {
                        confirmedVotes.push({
                            opNum: SteemOperationNumber.fromOperation(item.rawOp),
                            voteorderTransactionId: item.op.transaction_id
                        });
                        foundVoteConfirmation = true;
                    }
                    else if (item.op.name === "set_rules") {
                        for (let i = 0; i < item.op.rulesets.length; i++) {
                            const ruleset = item.op.rulesets[i];
                            rulesets.push({
                                opNum: SteemOperationNumber.fromOperation(item.rawOp),
                                ruleset: ruleset,
                                validityUntil: new SteemOperationNumber(Infinity, Infinity, Infinity)
                            });
                        }
                        if (foundVoteConfirmation) return false;
                    }

                    return true;
                }))
                .catch((error: Error) => {
                    reject(error);
                    return false;
                });
            })
            .start(() => {
                rulesets = this.calculateRulesetValidityInterval(rulesets);
                resolve({rulesets: rulesets, confirmedVotes: confirmedVotes});
            });
        });
    }

    private calculateRulesetValidityInterval = (rulesets: RulesetAtMoment []) => {
        rulesets.sort((a, b) => {
            if (a.opNum.isLesserThan(b.opNum))
                return -1;
            if (a.opNum.isGreaterThan(b.opNum))
                return 1;
            return 0;
        });
        for (let i = 0; i < rulesets.length; i++) {
            if (i + 1 < rulesets.length)
                rulesets[i].validityUntil = rulesets[i + 1].opNum;
            else
                rulesets[i].validityUntil = new SteemOperationNumber(Infinity, Infinity, Infinity);
        }
        return rulesets;
    }

    /*private calculateOldestTransactionNumber = (input: BeforeSyncData1): Promise<BeforeSyncData2> => {
        return new Promise((resolve, reject) => {
            let oldest: TransactionNumber | undefined = undefined;
            if (input.confirmedVotes.length > 0) {
                for (let i = 0; i < input.confirmedVotes.length; i++) {
                    const tn = input.confirmedVotes[i].tn;
                    if (!oldest || tn.isSmallerThan(oldest)) oldest = tn;
                }
            }
            else {
                for (let i = 0; i < input.rulesets.length; i++) {
                    const tn = input.rulesets[i].tn;
                    if (!oldest || tn.isSmallerThan(oldest)) oldest = tn;
                }
            }

            if (!oldest) oldest = new TransactionNumber(0, 0);

            resolve({rulesets: input.rulesets, confirmedVotes: input.confirmedVotes, oldestTn: oldest});
        });
    }*/

    private loadVoteorders = (input: {rulesets: RulesetAtMoment [], confirmedVotes: VoteConfirmedAtMoment []}): Promise<{rulesets: RulesetAtMoment [], confirmedVotes: VoteConfirmedAtMoment [], voteorders: VoteorderAtMoment []}> => {
        const voters: string [] = [];
        const votersLookupSince: SteemOperationNumber [] = [];

        for (let i = 0; i < input.rulesets.length; i++) {
            const ruleset = input.rulesets[i];
            if (voters.indexOf(ruleset.ruleset.voter) !== -1) {
                const index = voters.indexOf(ruleset.ruleset.voter);
                if (ruleset.opNum.isLesserThan(votersLookupSince[index])) votersLookupSince[index] = ruleset.opNum;
            }
            else {
                voters.push(ruleset.ruleset.voter);
                votersLookupSince.push(ruleset.opNum);
            }
        }

        const promises: Promise<VoteorderAtMoment[]> [] = [];
        for (let i = 0; i < voters.length; i++) {
            promises.push(this.loadUserVoteorders(voters[i], votersLookupSince[i]));
        }

        return Promise.all(promises).then(
            (value: {}[]): {rulesets: RulesetAtMoment [], confirmedVotes: VoteConfirmedAtMoment [], voteorders: VoteorderAtMoment []} => {
                const voteorders: VoteorderAtMoment [] = [];
                for (let i = 0; i < value.length; i++) {
                    const voteorder = value[i] as VoteorderAtMoment;
                    voteorders.push(voteorder);
                }
                return {confirmedVotes: input.confirmedVotes, rulesets: input.rulesets, voteorders: voteorders};
            }
        );
    }

    private loadUserVoteorders = (voter: string, lookupSince: SteemOperationNumber): Promise<VoteorderAtMoment[]> => {
        this.proggressCallback("Loading voteorders from " + voter + "...", 0.4);

        const voteorders: VoteorderAtMoment [] = [];
        return new Promise((resolve, reject) => {
            new AccountHistorySupplier(this.steem, voter)
            .branch((historySupplier) => {
                historySupplier
                .chain(new SmartvotesFilter())
                .chain(new OperationNumberLimiter(">=", lookupSince))
                .chain(new BiTransformer())
                .chain(new SimpleTaker((item: {rawOp: RawOperation, op: smartvotes_operation}): boolean => {
                    if (item.op.name === "send_voteorder") {
                        voteorders.push({
                            voter: voter,
                            voteorder: item.op.voteorder,
                            opNum: SteemOperationNumber.fromOperation(item.rawOp),
                            transactionId: item.rawOp[1].trx_id
                        });
                    }

                    return true;
                }))
                .catch((error: Error) => {
                    reject(error);
                    return false;
                });
            })
            .start(() => {
                this.proggressCallback("Done loading voteorders from " + voter + ".", 0.4);
                resolve(voteorders);
            });
        });
    }

    private removeAlreadyConfirmedVotes = (input: {rulesets: RulesetAtMoment [], confirmedVotes: VoteConfirmedAtMoment [],
                voteorders: VoteorderAtMoment []}): Promise<{rulesets: RulesetAtMoment [],
                confirmedVotes: VoteConfirmedAtMoment [], voteorders: VoteorderAtMoment []}> => {
        return new Promise((resolve, reject) => {
            const unsyncedVoteorders: VoteorderAtMoment [] = [];

            for (let i = 0; i < input.voteorders.length; i++) {
                const voteorder = input.voteorders[i];
                let unsynced = true;
                for (let j = 0; i < input.confirmedVotes.length; j++) {
                    const confirmedVote = input.confirmedVotes[j];
                    if (voteorder.transactionId === confirmedVote.voteorderTransactionId) {
                        unsynced = false;
                        break;
                    }
                }
                if (unsynced) unsyncedVoteorders.push(voteorder);
            }

            resolve({voteorders: unsyncedVoteorders, rulesets: input.rulesets, confirmedVotes: input.confirmedVotes});
        });
    }

    private sortVoteordersFromOldestToNewest = (input: {rulesets: RulesetAtMoment [], confirmedVotes: VoteConfirmedAtMoment [],
            voteorders: VoteorderAtMoment []}): Promise<{rulesets: RulesetAtMoment [], confirmedVotes: VoteConfirmedAtMoment [],
            voteorders: VoteorderAtMoment []}> => {
        return new Promise((resolve, reject) => {
            const voteorders = input.voteorders; // there is no need to copy them (just sort)
            voteorders.sort((a, b): number => {
                return a.opNum.isGreaterThan(b.opNum) ? -1 : a.opNum.isLesserThan(b.opNum) ? 1 : 0;
            });

            resolve({voteorders: voteorders, rulesets: input.rulesets, confirmedVotes: input.confirmedVotes});
        });
    }

    private removeDuplicateVoteorders = (input: {rulesets: RulesetAtMoment [], confirmedVotes: VoteConfirmedAtMoment [],
        voteorders: VoteorderAtMoment []}): Promise<{rulesets: RulesetAtMoment [], confirmedVotes: VoteConfirmedAtMoment [],
        voteorders: VoteorderAtMoment []}> => {
        return new Promise((resolve, reject) => {
            const cleanedVoteorders: VoteorderAtMoment [] = []; // there is no need to copy them (just sort)
            for (let i = 0; i < input.voteorders.length; i++) {
                const voteorderCandidate = input.voteorders[i];
                let duplicate = false;
                for (let j = 0; j < cleanedVoteorders.length; j++) {
                    const potentiallyDuplicated = cleanedVoteorders[j];
                    if (potentiallyDuplicated.voteorder.author === voteorderCandidate.voteorder.author
                        && potentiallyDuplicated.voteorder.permlink === voteorderCandidate.voteorder.permlink) {
                            duplicate = true;
                            cleanedVoteorders.splice(j, 1); // ensure only the newest voteorder for the post is used (that is why we remove older one).
                            cleanedVoteorders.push(voteorderCandidate);
                        }
                }
                if (!duplicate) cleanedVoteorders.push(voteorderCandidate);
            }

            resolve({voteorders: cleanedVoteorders, rulesets: input.rulesets, confirmedVotes: input.confirmedVotes});
        });
    }

    private validateAndSend = (input: {rulesets: RulesetAtMoment [], confirmedVotes: VoteConfirmedAtMoment [],
            voteorders: VoteorderAtMoment []}): Promise<void> => {
        /* tslint:disable no-null-keyword  */
        return new Promise((resolve, reject) => {
            for (let i = 0; i < input.voteorders.length; i++) {
                const voteorder = input.voteorders[i];
            }

            console.log("Loaded: ");
            console.log(JSON.stringify(input, null, 2));

            resolve();
        });
    }
}