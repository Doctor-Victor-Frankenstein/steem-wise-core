import { expect, assert } from "chai";
import * as Promise from "bluebird";
import * as _ from "lodash";
import "mocha";

import { Wise, SteemOperationNumber, SendVoteorder, SetRules, AuthorsRule, WeightRule } from "../src/wise";
import { SteemPost } from "../src/blockchain/SteemPost";
import { FakeApi } from "../src/api/FakeApi";
import { Util } from "../src/util/util";
import { Synchronizer } from "../src/Synchronizer";
import { isSetRules, EffectuatedSetRules } from "../src/protocol/SetRules";
import { isConfirmVote, ConfirmVote } from "../src/protocol/ConfirmVote";

import * as fakeDataset_ from "./data/fake-blockchain.json";
import { EffectuatedSmartvotesOperation } from "../src/protocol/EffectuatedSmartvotesOperation";
const fakeDataset = fakeDataset_ as object as FakeApi.Dataset;


/**
 * Setup
 */
const voter = "voter123";
const delegator = "delegator456";
const fakeApi: FakeApi = FakeApi.fromDataset(fakeDataset);
const delegatorWise = new Wise(delegator, fakeApi);
const voterWise = new Wise(voter, fakeApi);



/**
 * Run!
 */
let synchronizer: Synchronizer;

describe("test/index.spec.ts", () => {
    describe("Synchronizer", function() {
        this.timeout(15000);
        let synchronizationPromise: Promise<void>;
        it("Starts synchronization without error", () => {
            const synchronizationPromiseReturner = () => new Promise<void>((resolve, reject) => {
                synchronizer = delegatorWise.runSynchronizerLoop(new SteemOperationNumber(fakeApi.getCurrentBlockNum(), 0, 0),
                    (error: Error | undefined, event: Synchronizer.Event): void => {
                    if (event.type === Synchronizer.EventType.SynchronizationStop) {
                        resolve();
                    }
                    console.log(event);

                    if (error) {
                        reject(error);
                        synchronizer.stop();
                    }
                });
            });
            synchronizationPromise = synchronizationPromiseReturner();
        });

        it("rejects voteorder sent before rules", () => {
            const post: SteemPost = Util.definedOrThrow(_.sample(fakeDataset.posts), new Error("post is undefined"));
            const vo: SendVoteorder = {
                rulesetName: "RulesetOneChangesContent",
                author: post.author,
                permlink: post.permlink,
                weight: 10000
            };

            const skipValidation = true;
            return voterWise.sendVoteorderAsync(delegator, vo, () => {}, skipValidation)
            .then((son: SteemOperationNumber) => {
                expect(son.blockNum).to.be.greaterThan(0);
            })
            .then(() => Promise.delay(25))
            .then(() => {
                const lastOp = Util.definedOrThrow(_.last(fakeApi.getPushedOperations()));
                const handleResult = Util.definedOrThrow(delegatorWise.getProtocol().handleOrReject(lastOp));
                expect(handleResult).to.be.an("array").with.length(1);
                expect(isConfirmVote(handleResult[0].command)).to.be.true;
                expect((handleResult[0].command as ConfirmVote).accepted).to.be.false;
            });
        });

        it("Delegator sets rules for voter", () => {
            const sendRules: SetRules = {
                rulesets: [
                    {
                        name: "RulesetOneChangesContent",
                        rules: [
                            new AuthorsRule(AuthorsRule.Mode.ALLOW, ["noisy"]),
                            new WeightRule(WeightRule.Mode.SINGLE_VOTE_WEIGHT, 0, 2000)
                        ]
                    },
                    {
                        name: "RulesetTwoWillBeRemoved",
                        rules: [
                            new AuthorsRule(AuthorsRule.Mode.ALLOW, ["perduta"]),
                            new WeightRule(WeightRule.Mode.SINGLE_VOTE_WEIGHT, 0, 2000)
                        ]
                    }
                ]
            };
            return delegatorWise.sendRulesAsync(voter, sendRules)
            .then((son: SteemOperationNumber) => {
                expect(son.blockNum).to.be.greaterThan(0);
            })
            .then(() => Promise.delay(25))
            .then(() => {
                return voterWise.getRulesetsAsync(delegator, SteemOperationNumber.FUTURE);
            })
            .then((gotRules: SetRules) => {
                expect(gotRules.rulesets).to.be.an("array").with.length(sendRules.rulesets.length);
                sendRules.rulesets.forEach((gotRule, i) => expect(gotRule.name).to.be.equal(sendRules.rulesets[i].name));
            });
        });

        const validVoteorders1: SendVoteorder [] = [
            {
                rulesetName: "RulesetOneChangesContent",
                author: "noisy",
                permlink: "what-we-can-say-about-steem-users-based-on-traffic-generated-to-steemprojects-com-after-being-3-days-on-top-of-trending-page",
                weight: 1
            },
            {
                rulesetName: "RulesetTwoWillBeRemoved",
                author: "perduta",
                permlink: "do-you-feel-connected-to-your-home-country",
                weight: 1
            }
        ];
        validVoteorders1.forEach((voteorder: SendVoteorder) => it("Voter sends valid voteorder (ruleset=" + voteorder.rulesetName + ") and delegator passes them", () => {
            return voterWise.sendVoteorderAsync(delegator, voteorder)
            .then((moment: SteemOperationNumber) => expect(moment.blockNum).to.be.greaterThan(0))
            .then(() => Promise.delay(25))
            .then(() => {
                const lastPushedOp = Util.definedOrThrow(_.last(fakeApi.getPushedOperations()));
                console.log(lastPushedOp);
                const handledOps: EffectuatedSmartvotesOperation [] = Util.definedOrThrow(delegatorWise.getProtocol().handleOrReject(lastPushedOp));
                const lastHandledOp = Util.definedOrThrow(_.last(handledOps));
                expect(isConfirmVote(lastHandledOp.command)).to.be.true;
                expect((lastHandledOp.command as ConfirmVote).accepted).to.be.true;
            });
        }));

        const invalidVoteorders1: SendVoteorder [] = [
            {
                rulesetName: "RulesetOneChangesContent",
                author: "perduta",
                permlink: "do-you-feel-connected-to-your-home-country",
                weight: 1
            },
            {
                rulesetName: "RulesetTwoWillBeRemoved",
                author: "noisy",
                permlink: "what-we-can-say-about-steem-users-based-on-traffic-generated-to-steemprojects-com-after-being-3-days-on-top-of-trending-page",
                weight: 1
            }
        ];
        invalidVoteorders1.forEach((voteorder: SendVoteorder) => it("Voter sends invalid voteorder (ruleset=" + voteorder.rulesetName + ") and delegator rejects them", () => {
            return voterWise.sendVoteorderAsync(delegator, voteorder)
            .then((moment: SteemOperationNumber) => expect(moment.blockNum).to.be.greaterThan(0))
            .then(() => Promise.delay(25))
            .then(() => {
                const lastPushedOp = Util.definedOrThrow(_.last(fakeApi.getPushedOperations()));
                const handledOps: EffectuatedSmartvotesOperation [] = Util.definedOrThrow(delegatorWise.getProtocol().handleOrReject(lastPushedOp));
                const lastHandledOp = Util.definedOrThrow(_.last(handledOps));
                expect(isConfirmVote(lastHandledOp.command)).to.be.true;
                expect((lastHandledOp.command as ConfirmVote).accepted).to.be.false;
            });
        }));

        it.skip("Delegator changes rules", () => {
            return Promise.resolve();
        });

        it.skip("Voter sends valid and invalid voteorders", () => {
            return Promise.resolve();
        });

        it.skip("Delegator passes valid voteorders", () => {
            return Promise.resolve();
        });

        it.skip("Delegator rejects invalid voteorders", () => {
            return Promise.resolve();
        });

        it.skip("Delegator rejects nonexistent post with negative confirmation but without error", () => {
            return Promise.resolve();
        });

        it("Stops synchronization properly", () => {
            synchronizer.stop();
            return fakeApi.pushFakeBlock().then((son: SteemOperationNumber) => {
                return synchronizationPromise.then(() => {});
            }).then(() => {});
        });

        it("Ends synchronization without error", () => {
            return synchronizationPromise.then(() => {});
        });

    });
});