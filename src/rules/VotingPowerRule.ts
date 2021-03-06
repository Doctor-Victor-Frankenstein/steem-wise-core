import * as _ from "lodash";

import { Rule } from "./Rule";
import { ValidationException } from "../validation/ValidationException";
import { ValidationContext } from "../validation/ValidationContext";
import { SendVoteorder } from "../protocol/SendVoteorder";

export class VotingPowerRule extends Rule {
    public rule: string = Rule.Type.VotingPower;
    public value: number;
    public mode: VotingPowerRule.Mode;

    public constructor(mode: VotingPowerRule.Mode, value: number) {
        super();

        this.mode = mode;
        this.value = value;
    }

    public type(): Rule.Type {
        return Rule.Type.VotingPower;
    }

    public async validate(voteorder: SendVoteorder, context: ValidationContext) {
        this.validateRuleObject(this);
        const delegatorAccount = await context.getAccountInfo(context.getDelegatorUsername());
        if (!delegatorAccount) throw new Error("Delegator account info is undefined");

        if (this.mode == VotingPowerRule.Mode.EQUAL) {
            if (delegatorAccount.voting_power !== this.value)
                throw new ValidationException(
                    "Delegator voting power (" +
                        this.votingpowerToPercent(delegatorAccount.voting_power) +
                        ") does not equal " +
                        this.votingpowerToPercent(this.value)
                );
        } else if (this.mode == VotingPowerRule.Mode.MORE_THAN) {
            if (delegatorAccount.voting_power <= this.value)
                throw new ValidationException(
                    "Delegator voting power (" +
                        this.votingpowerToPercent(delegatorAccount.voting_power) +
                        ") is not more than " +
                        this.votingpowerToPercent(this.value)
                );
        } else if (this.mode == VotingPowerRule.Mode.LESS_THAN) {
            if (delegatorAccount.voting_power >= this.value)
                throw new ValidationException(
                    "Delegator voting power (" +
                        this.votingpowerToPercent(delegatorAccount.voting_power) +
                        ") is not less than " +
                        this.votingpowerToPercent(this.value)
                );
        } else {
            throw new Error("Unknown mode of voting power rule: " + this.mode);
        }
    }

    public validateRuleObject(unprototypedObj: any) {
        ["value", "mode"].forEach(prop => {
            if (!_.has(unprototypedObj, prop))
                throw new ValidationException("VotingPowerRule: property " + prop + " is missing");
        });

        if (
            !_.includes(
                [VotingPowerRule.Mode.MORE_THAN, VotingPowerRule.Mode.LESS_THAN, VotingPowerRule.Mode.EQUAL],
                unprototypedObj.mode
            )
        )
            throw new ValidationException("VotingPowerRule: unknown mode " + unprototypedObj.mode);

        if (unprototypedObj.value > 10000) {
            throw new ValidationException(
                `VotingPowerRule: voting power (${unprototypedObj.value}) cannot be greater than 100%`
            );
        }

        if (unprototypedObj.value < 0) {
            throw new ValidationException(
                `VotingPowerRule: voting power (${unprototypedObj.value}) cannot be less than 0%`
            );
        }
    }

    public getDescription(): string {
        let out = "The delegator has ";

        switch (this.mode) {
            case VotingPowerRule.Mode.MORE_THAN:
                out += "more than";
                break;
            case VotingPowerRule.Mode.LESS_THAN:
                out += "less than";
                break;
            case VotingPowerRule.Mode.EQUAL:
                out += "exactly";
                break;
            default:
                out += this.mode;
        }
        out += " " + this.votingpowerToPercent(this.value) + " voting power";

        return out;
    }

    private votingpowerToPercent(vp: number): string {
        return (vp / 100).toFixed(2) + "%";
    }
}

export namespace VotingPowerRule {
    export enum Mode {
        MORE_THAN = "more_than",
        LESS_THAN = "less_than",
        EQUAL = "equal",
    }
}
