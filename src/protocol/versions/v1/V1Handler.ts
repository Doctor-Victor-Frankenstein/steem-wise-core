import { ProtocolVersionHandler } from "../ProtocolVersionHandler";
import { SmartvotesOperation } from "../../SmartvotesOperation";

import * as ajv from "ajv";
import * as schemaJSON from "./smartvotes.schema.json";
import { smartvotes_operation, smartvotes_command_set_rules, smartvotes_ruleset, smartvotes_command_send_voteorder } from "./smartvotes.schema";
import { SendVoteorder } from "../../SendVoteorder";
import { SetRules } from "../../SetRules";
import { Rule } from "../../../rules/Rule";
import { TagsRule } from "../../../rules/TagsRule";
import { AuthorsRule } from "../../../rules/AuthorsRule";
import { CustomRPCRule } from "../../../rules/CustomRPCRule";
import { SteemOperation } from "../../../blockchain/SteemOperation";
import { CustomJsonOperation } from "../../../blockchain/CustomJsonOperation";
import { EffectuatedSmartvotesOperation } from "../../EffectuatedSmartvotesOperation";

export class V1Handler implements ProtocolVersionHandler {
    public handleOrReject(op: SteemOperation): EffectuatedSmartvotesOperation [] | undefined {
        if (op.block_num > 22710498) return undefined; // this protocol version is disabled for new transactions

        if (op.op[0] != "custom_json" || (op.op[1] as CustomJsonOperation).id != "smartvote") return undefined;

        if ((op.op[1] as CustomJsonOperation).required_posting_auths.length != 1) return undefined; // must be authorized by single user

        const jsonObj = JSON.parse((op.op[1] as CustomJsonOperation).json);
        if (!this.validateJSON(jsonObj)) return undefined;

        const smartvotesOp = jsonObj as smartvotes_operation;
        return this.transform(op, smartvotesOp, (op.op[1] as CustomJsonOperation).required_posting_auths[0]);
    }

    private validateJSON(input: object): boolean {
        const aajv: ajv.Ajv = new ajv();
        aajv.addMetaSchema(require("ajv/lib/refs/json-schema-draft-06.json"));

        const validate = aajv.compile(schemaJSON);
        return validate(input) as boolean;
    }

    private transform(op: SteemOperation, smartvotesOp: smartvotes_operation, sender: string): EffectuatedSmartvotesOperation [] | undefined {
        if (smartvotesOp.name == "set_rules") { // sort for every voter
            return this.transformSetRules(op, smartvotesOp, sender);
        }
        else if (smartvotesOp.name == "send_voteorder") {
            return this.transformSendVoteorder(op, smartvotesOp, sender);
        }
        else return undefined;
    }

    private transformSetRules(op: SteemOperation, smartvotesOp: smartvotes_command_set_rules, sender: string): EffectuatedSmartvotesOperation [] {
        const rulesPerVoter: [string, {name: string, rules: Rule []}[]][] = [];

        for (let i = 0; i < smartvotesOp.rulesets.length; i++) {
            const ruleset = smartvotesOp.rulesets[i];
            let create = true;
            for (let j = 0; j < rulesPerVoter.length; j++) {
                if (rulesPerVoter[j][0] === ruleset.voter) {
                    rulesPerVoter[j][1].push(this.transformRuleset(ruleset));
                    create = false;
                }
            }
            if (create) {
                rulesPerVoter.push([ruleset.voter, [this.transformRuleset(ruleset)]]);
            }
        }

        const out: EffectuatedSmartvotesOperation [] = [];

        for (let i = 0; i < rulesPerVoter.length; i++) {
            const cmd: SetRules = {
                rulesets: rulesPerVoter[i][1]
            };

            out.push({
                block_num: op.block_num,
                transaction_num: op.transaction_num,
                transaction_id: op.transaction_id,
                operation_num: op.operation_num,
                timestamp: op.timestamp,

                voter: rulesPerVoter[i][0],
                delegator: sender,

                command: cmd
            } as EffectuatedSmartvotesOperation);
        }

        return out;
    }

    private transformRuleset(ruleset: smartvotes_ruleset): {name: string, rules: Rule []} {
        const rules: Rule [] = [];

        for (let i = 0; i < ruleset.rules.length; i++) {
            const rule = ruleset.rules[i];
            if (rule.type === "tags") {
                if (rule.mode === "allow") rules.push(new TagsRule(TagsRule.Mode.ALLOW, rule.tags));
                else if (rule.mode === "deny") rules.push(new TagsRule(TagsRule.Mode.DENY, rule.tags));
                else if (rule.mode === "require") rules.push(new TagsRule(TagsRule.Mode.REQUIRE, rule.tags));
                else if (rule.mode === "any") rules.push(new TagsRule(TagsRule.Mode.ANY, rule.tags));
            }
            else if (rule.type === "authors") {
                if (rule.mode === "allow") rules.push(new AuthorsRule(AuthorsRule.Mode.ALLOW, rule.authors));
                else if (rule.mode === "deny") rules.push(new AuthorsRule(AuthorsRule.Mode.DENY, rule.authors));
            }
            else if (rule.type === "custom_rpc") {
                rules.push(new CustomRPCRule(rule.rpc_host, rule.rpc_port, rule.rpc_path, rule.rpc_method));
            }
        }

        return {name: ruleset.name, rules: rules};
    }

    private transformSendVoteorder(op: SteemOperation, smartvotesOp: smartvotes_command_send_voteorder, sender: string): EffectuatedSmartvotesOperation [] {
        const cmd: SendVoteorder = {
            rulesetName: smartvotesOp.voteorder.ruleset_name,
            permlink: smartvotesOp.voteorder.permlink,
            author: smartvotesOp.voteorder.author,
            weight: smartvotesOp.voteorder.weight * (smartvotesOp.voteorder.type == "flag" ? -1 : 1)
        };
        return [{
            block_num: op.block_num,
            transaction_num: op.transaction_num,
            transaction_id: op.transaction_id,
            operation_num: op.operation_num,
            timestamp: op.timestamp,

            voter: sender,
            delegator: smartvotesOp.voteorder.delegator,

            command: cmd
        } as EffectuatedSmartvotesOperation];
    }

    public serializeToBlockchain(op: SmartvotesOperation): [string, object][] {
        throw new Error("Not implemented yet");
    }
}