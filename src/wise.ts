/* PROMISE_DEF */
import * as BluebirdPromise from "bluebird";
/* END_PROMISE_DEF */
import * as _ from "lodash";
import * as steem from "steem";

import { SteemOperationNumber } from "steem-efficient-stream";
import { Protocol } from "./protocol/Protocol";
import { V1Handler } from "./protocol/versions/v1/V1Handler";
import { Api } from "./api/Api";
import { SendVoteorder } from "./protocol/SendVoteorder";
import { WiseOperation } from "./protocol/WiseOperation";
import { ValidationException } from "./validation/ValidationException";
import { Validator } from "./validation/Validator";
import { LegacySynchronizer } from "./synchronizer/LegacySynchronizer";
import { V2Handler } from "./protocol/versions/v2/V2Handler";
import { RulesUpdater } from "./RulesUpdater";
import { Log } from "./log/Log";
import { Ruleset } from "./protocol/Ruleset";
import { SetRulesForVoter } from "./protocol/SetRulesForVoter";
import { EffectuatedSetRules } from "./protocol/EffectuatedSetRules";
import { SingleDaemon } from "./synchronizer/SingleDaemon";

/**
 * Wise is a vote delegation system for steem blockchain. Wise allows you to securely grant other steemians your voting
 * power under conditions specified by you. For usage examples and more information please refer README. A complete cli
 * tool that enables performing all wise operations is available in package steem-wise-cli. A manual is available at
 * https://noisy-witness.github.io/steem-wise-manual/introduction.
 *
 * This is the main class of Wise.
 */
export class Wise {
    private account: string;
    private api: Api;
    private protocol: Protocol;

    /**
     * Constructs wise object.
     *
     * @constructor
     * @param {string} account - steem account name for performing operations (a voter if sending voteorder, a delegator
     *      if setting rules).
     * @param {Api} api - an Api (Direct blockchain api, our REST database, or any custom api that
     *      implements Api abstract class)
     * @param {Protocol} [protocol=(default protocol)] -  a Protocol object with Protocol version handlers specified.
     *      If not specified a default protocol object is created. We recommend you to use the default protocol
     *      (leave this option) as it is always up-to-date.
     */
    constructor(account: string, api: Api, protocol?: Protocol) {
        this.account = account;
        this.api = api;
        if (protocol) {
            this.protocol = protocol;
        } else {
            this.protocol = Wise.constructDefaultProtocol();
        }
    }

    /**
     * Uploads rulesets for this voter to the blockchain.
     *
     * @param {string} voter - voter for whom these rulesets are set.
     * @param {Ruleset []} rules - an array of rulesets for this voter
     * @param {(msg: string, proggress: number) => void} [proggressCallback] proggress callback that will receive
     *      proggress notifications (useful for UI)
     *
     * @returns {Promise<SteemOperationNumber>} - a Promise that resolves with SteemOperationNumber which indicates
     *      the blockchain moment of this wiseoperation.
     */
    public uploadRulesetsForVoter = (
        voter: string,
        rulesets: Ruleset[],
        proggressCallback: ProggressCallback = () => {}
    ): Promise<SteemOperationNumber> => {
        return RulesUpdater.uploadRulesetsForVoter(
            this.api,
            this.protocol,
            this.account,
            voter,
            rulesets,
            proggressCallback
        );
    };

    /**
     * Download rulesets set by the delegator for a specified voter.
     *
     * @param {string} delegator - the delegator account name
     * @param {string} voter - the voter account name
     * @param {SteemOperationNumber} [atMoment = SteemOperationNumber.NOW] - a moment in blockchain (block, transaction,
     *      and operation number). Default is SteemOperationNumber.NOW.
     *
     * @returns {Promise<Ruleset []>} - a Promise that resolves with rulesets that are in effect at the specified moment
     *      or now.
     */
    public downloadRulesetsForVoter = async (
        delegator: string,
        voter: string,
        atMoment: SteemOperationNumber = SteemOperationNumber.NOW
    ): Promise<Ruleset[]> => {
        const setRules = await this.api.loadRulesets({ delegator: delegator, voter: voter }, atMoment);
        if (setRules.length > 0) return setRules[0].rulesets;
        else return [];
    };

    /**
     * Uploads all rulesets for this delegator account for all voters. First it reads the account history and looks
     * for all rulesets thet were set and are currently in power. Then it compares it with provided new rulesets.
     * It then:
     *  - sends new rulesets if no rules were set previously for particular voter
     *  - sends new rulesets if rules for particular voter changed
     *  - clears out the rules for voters that previously had rules, but are not listed in current rules (this is done
     *    by sending empty array of rulesets).
     *
     * @param {SetRulesForVoter} rules - new rules for all voters of this delegator
     * @param {(error: Error, result: SteemOperationNumber | true) => void} [callback=undefined] -
     *      callback function that will be called when rules are uploaded or an error occurs. Can be ommited or set
     *      to undefined if you want to only use the returned promise.
     * @param {(msg: string, proggress: number) => void} [proggressCallback] proggress callback that will receive
     *      proggress notifications (useful for UI)
     *
     * @returns {Promise<SteemOperationNumber>} - a Promise that resolves with SteemOperationNumber or true.
     *      SteemOperationNumber indicates that rules were updated and contains the blockchain moment of last update
     *      operation. True indicates that rules were already up to date and no operations were sent to blockchain.
     */
    public uploadAllRulesets = (
        rules: SetRulesForVoter[],
        proggressCallback: ProggressCallback = () => {}
    ): Promise<SteemOperationNumber | true> => {
        return RulesUpdater.uploadAllRulesets(this.api, this.protocol, this.account, rules, proggressCallback);
    };

    /**
     * Downloads from blockchain all rules set by specified delegator (default is provided accound) at specified moment
     * (default moment is NOW).
     *
     * @param {string} [delegator] - account name of the delegator (default is account name set in constructor of this
     *      Wise instance)
     * @param {SteemOperationNumber} [atMoment = SteemOperationNumber.NOW] - a moment in blockchain (block, transaction,
     *      and operation number). Default is SteemOperationNumber.NOW.
     * @param {(msg: string, proggress: number) => void} [proggressCallback] proggress callback that will receive
     *      proggress notifications (useful for UI)
     *
     * @returns {Promise<EffectuatedSetRules []>} - a Promise that resolves with SteemOperationNumber or true.
     *      SteemOperationNumber indicates that rules were updated and contains the blockchain moment of last update
     *      operation. True indicates that rules were already up to date and no operations were sent to blockchain.
     */
    public downloadAllRulesets = (
        delegator: string = this.account,
        atMoment: SteemOperationNumber = SteemOperationNumber.NOW,
        proggressCallback: ProggressCallback = () => {}
    ): Promise<EffectuatedSetRules[]> => {
        proggressCallback("Downloading all rulesets set by " + delegator, 0.0);
        const result = RulesUpdater.downloadAllRulesets(this.api, delegator, atMoment);
        proggressCallback("Downloaded all rulesets set by " + delegator, 1.0);
        return result;
    };

    /**
     * This method generates an array of steem operations that have to be sent to emit a Wise voteorder. This method
     * allows e.g. sending the voteorder through SteemConnect or generating a Vessel link.
     *
     * @param {string} delegator - account name of the delegator
     * @param {string} voter - account name of the voter
     * @param {SendVoteorder} voteorder - voteorder object
     * @param {(msg: string, proggress: number) => void} [proggressCallback] proggress callback that will receive
     *      proggress notifications (useful for UI)
     * @param {boolean} [skipValidation=false] allows to skip validation (send is immediate and allows sending
     *      invalid voteorder).
     *
     * @returns {Promise<steem.OperationWithDescriptor[]>} - a Promise that resolves with an array of steem operations that can
     * be directly sent to the blockchain using broadcast send in RPC/WS, or using external tool such as vessel
     * or steemconnect.
     */
    public generateVoteorderOperations = async (
        delegator: string,
        voter: string,
        voteorder: SendVoteorder,
        proggressCallback: ProggressCallback = () => {},
        skipValidation: boolean = false
    ): Promise<steem.OperationWithDescriptor[]> => {
        proggressCallback("Validating voteorder...", 0.0);

        const smOp: WiseOperation = {
            voter: voter,
            delegator: delegator,
            command: voteorder,
        };
        const steemOps = this.protocol.serializeToBlockchain(smOp);
        if (steemOps.length !== 1) throw new Error("A voteorder should be a single blockchain operation");
        if (!skipValidation && !this.protocol.validateOperation(steemOps[0]))
            throw new Error("Operation object has invalid structure");

        if (!skipValidation) {
            const validationResult: ValidationException | true = await this.validateVoteorder(
                delegator,
                voter,
                voteorder,
                SteemOperationNumber.FUTURE,
                proggressCallback
            );
            if (validationResult !== true) throw new Error("Validation error: " + validationResult.message);
            proggressCallback("Voteorder validation done", 1.0);
        }
        return steemOps;
    };

    /**
     * Sends a voteorder to the blockchain.
     *
     * @param {string} delegator - account name of the delegator
     * @param {SendVoteorder} voteorder - voteorder object
     * @param {(msg: string, proggress: number) => void} [proggressCallback] proggress callback that will receive
     *      proggress notifications (useful for UI)
     * @param {boolean} [skipValidation=false] allows to skip validation (send is immediate and allows sending
     *      invalid voteorder).
     *
     * @returns {Promise<SteemOperationNumber>} - a Promise that resolves with SteemOperationNumber when the voteorder
     *      is sent successfully.
     */
    public sendVoteorder = async (
        delegator: string,
        voteorder: SendVoteorder,
        proggressCallback: ProggressCallback = () => {},
        skipValidation: boolean = false
    ): Promise<SteemOperationNumber> => {
        const steemOps = await this.generateVoteorderOperations(
            delegator,
            this.account,
            voteorder,
            proggressCallback,
            skipValidation
        );
        proggressCallback("Sending voteorder...", 0.5);
        const sentMoment = await this.api.sendToBlockchain(steemOps);
        proggressCallback("Sending voteorder done", 1.0);
        return sentMoment;
    };

    /**
     * Validates a voteorder. Both structure and rules.
     *
     * @param {string} delegator - delegator account name
     * @param {string} voter - voter account name
     * @param {SendVoteorder} voteorder - a voteorder object
     * @param {SteemOperationNumber} atMoment - a moment in blockchain at which we are testing the voteorder validity
     *      (usually this is a moment at which the voteorder appeared on the blockchain). Set atMoment to
     *      SteemOperationNumber.FUTURE, which will indicate a potential (not sent) voteorder.
     * @param {(msg: string, proggress: number) => void} [proggressCallback] proggress callback that will receive
     *      proggress notifications (useful for UI)
     *
     * @returns {Promise<ValidationException | true>} - a Promise that resolves with ValidationException or true.
     *      If the validation was successful result === true. If it was not, result is an instance of
     *      ValidationException. Note that ValidationException is not thrown, nor returned as rejection. Other errors
     *      are thrown/rejected.
     */
    public validateVoteorder = (
        delegator: string,
        voter: string,
        voteorder: SendVoteorder,
        atMoment: SteemOperationNumber,
        proggressCallback: ProggressCallback = () => {}
    ): Promise<ValidationException | true> => {
        const v = new Validator(this.api);
        if (proggressCallback) v.withProggressCallback(proggressCallback);

        return v.validate(delegator, voter, voteorder, atMoment);
    };

    /**
     * Returns the moment in the blockchain of the newest confirmation of a specified delegator.
     *
     * @param {string} delegator - the delegator account name
     * @param {(error: Error, result: undefined | SteemOperationNumber)} [callback=undefined] -
     *      callback function that will be called when the result is ready. Can be ommited or set
     *      to undefined if you want to only use the returned promise. Result value is same as in returned Promise.
     *
     * @returns {Promise<undefined | SteemOperationNumber>} - a Promise that resolves with undefined or
     * SteemOperationNumber. It resolves with undefined if this account has not sent any confirmations yet. Otherwise
     * it resolves with SteemOperationNumber pointing at the moment of the newest confirmation.
     */
    public getLastConfirmationMoment = (delegator: string): Promise<undefined | SteemOperationNumber> => {
        return this.api.getLastConfirmationMoment(delegator);
    };

    /**
     * Starts the Wise daemon. It reads blockchain transactions looking for Wise operations. When a new voteorder
     * is found, it is processed, validated and the daemon sends to the blockchain [vote + confirmation] on a valid
     * voteorder or [rejection message] on invalid one. It loops through blockchain operations starting from *since*
     * param. When it reaches the HEAD it loops through newcoming operations. It stops when notifierCallback returns
     * false.
     *
     * @param {SteemOperationNumber} since - moment in the blockchain to start synchronization from
     * @param {SingleDaemon.NotifierCallback} notifierCallback - a callback which is notified every time an event
     *      occurs. It should return true to continue synchronization, or false if to stop it.
     *
     * @returns - this method returns the Synchronizer object.
     */
    public startDaemon = (
        since: SteemOperationNumber,
        notifierCallback: SingleDaemon.NotifierCallback
    ): SingleDaemon => {
        const daemon = new SingleDaemon(this.api, this.protocol, this.account, notifierCallback);
        (async () => {
            await daemon.start(since);
        })();
        return daemon;
    };

    /**
     * Returns current protocol of this Wise object.
     *
     * @returns {Protocol} - the current Protocol of this Wise object.
     */
    public getProtocol = (): Protocol => {
        return this.protocol;
    };

    public static constructDefaultProtocol(): Protocol {
        return new Protocol([
            // a default protocol which handles both V2 and V1 messages on blockchain.
            new V2Handler(),
            new V1Handler(),
        ]);
    }

    public static getVersion(): string {
        return "4.0.0";
    }

    /**
     * Returns instance of Log singleton that is used inside steem-wise-core. This may look insane as Log is a singleton.
     * In fact. This is an antipattern in Typescript, although a very useful one. Static class members has a scope in
     * typescript. The scope is limited to a single node project. If we want to configure wise core log in another project
     * we have to get the singleton instance from inside of steem-wise-core package.
     */
    public static getLog(): Log {
        return Log.log();
    }
}

/**
 * A progress callback that is called every time a milestone in particular operation is achived. Msg is a textual
 * description of what happened, and proggress contains a fractional number (0.0 = 0%, 1.0 = 100%) which indicates
 * the proggress.
 */
export type ProggressCallback = (msg: string, proggress: number) => void;

/**
 * Prayer:
 *  Gloria Patri, et Filio, et Spiritui Sancto, sicut erat in principio et nunc et semper et in saecula
 *  saeculorum. Amen. In te, Domine, speravi: non confundar in aeternum.
 */

/**
 * Exports
 */
export { Api } from "./api/Api";
export { DirectBlockchainApi } from "./api/directblockchain/DirectBlockchainApi";
export { WiseSQLApi } from "./api/sql/WiseSQLApi";
export { WiseSQLProtocol } from "./api/sql/WiseSQLProtocol";
export { DisabledApi } from "./api/DisabledApi";

export { UnifiedSteemTransaction } from "steem-efficient-stream";
export { SteemOperationNumber } from "steem-efficient-stream";

export { Protocol } from "./protocol/Protocol";
export { ConfirmVote } from "./protocol/ConfirmVote";
export { ConfirmVoteBoundWithVote } from "./protocol/ConfirmVoteBoundWithVote";
export { SendVoteorder } from "./protocol/SendVoteorder";
export { Ruleset } from "./protocol/Ruleset";
export { SetRules } from "./protocol/SetRules";
export { SetRulesForVoter } from "./protocol/SetRulesForVoter";
export { EffectuatedSetRules } from "./protocol/EffectuatedSetRules";
export { WiseOperation } from "./protocol/WiseOperation";
export { EffectuatedWiseOperation } from "./protocol/EffectuatedWiseOperation";

export { Rule } from "./rules/Rule";
export { AuthorsRule } from "./rules/AuthorsRule";
export { TagsRule } from "./rules/TagsRule";
export { CustomRPCRule } from "./rules/CustomRPCRule";
export { WeightRule } from "./rules/WeightRule";
export { VotingPowerRule } from "./rules/VotingPowerRule";
export { AgeOfPostRule } from "./rules/AgeOfPostRule";
export { FirstPostRule } from "./rules/FirstPostRule";
export { PayoutRule } from "./rules/PayoutRule";
export { VotersRule } from "./rules/VotersRule";
export { VotesCountRule } from "./rules/VotesCountRule";
export { WeightForPeriodRule } from "./rules/WeightForPeriodRule";
export { ExpirationDateRule } from "./rules/ExpirationDateRule";
export { RulePrototyper } from "./rules/RulePrototyper";
export { RulesUpdater } from "./RulesUpdater";

export { Validator } from "./validation/Validator";
export { ValidationException } from "./validation/ValidationException";
export { ValidationContext } from "./validation/ValidationContext";

export { NotFoundException } from "./util/NotFoundException";

export { SingleDaemon } from "./synchronizer/SingleDaemon";
export { LegacySynchronizer } from "./synchronizer/LegacySynchronizer";
export { UniversalSynchronizer } from "./synchronizer/UniversalSynchronizer";
export { SynchronizerCallbacks } from "./synchronizer/SynchronizerCallbacks";

export * from "./protocol/versions/v2/wise-schema";

export default Wise;
