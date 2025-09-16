const CLASS_NAMES = ["Warrior", "Lancer", "Slayer", "Berserker", "Sorcerer", "Archer", "Priest", "Mystic", "Reaper", "Gunner"]

// movingCharge never gets sActionEnd, instead connects to new sActionStage on release
// catchBack, shorTel, positionswap, inversecapture need to wait for movement
// notimeline, drain, and defence are held indefinitely
const DISABLED_SKILL_TYPES = ["catchBack", "shortTel", "positionswap", "inversecapture", "movingCharge", "notimeline", "drain", "defence"]

class PingCompensation {
    constructor(mod) {
        this.skills = require("./skills.json")
        this.config = require("./config.json")

        this.mod = mod
        this.hooks = []

        this.debugging = false
        this.enabled = true

        // if skill-prediction is detected, skip own ping statistics and skill
        // cooldown duration corrections. Also block retries for disabled skills.
        this.skillPrediction = this.config?.Settings?.SkillPrediciton ?? false

        this.pingHistorySetting = this.config?.Settings?.PingHistory ?? 30
        this.pingIntervalSetting = this.config?.Settings?.PingInterval ?? 4000
        this.pingOffsetSetting = this.config?.Settings?.PingOffset ?? 0
        this.pingHistory = []
        this.pingMin = 1
        this.pingMax = 1000
        this.pingTime = 0
        this.pingWaiting = false
        this.pingTimer = null

        this.rubberBandDistSetting = this.config?.Settings?.RubberBandDistance ?? 300
        this.actionName = null
        this.actionEnd = null
        this.actionEndSpeed = 1.0
        this.actionEndTime = null
        this.actionEndTimer = null
        this.sendingActionEnd = false

        this.retryCountSetting = this.config?.Settings?.RetryCount ?? 2
        this.retryTimeoutSetting = this.config?.Settings?.RetryTimeout ?? 100
        this.retryDelaySetting = this.config?.Settings?.RetryDelay ?? 30
        this.noRetryDelaySetting = this.config?.Settings?.NoRetryDelay ?? 60
        this.retryNext = false
        this.retryBuffer = null
        this.retryCount = 0
        this.retryTimer = null
        this.retryTimeout = null

        this.initialize = this.initialize.bind(this)
        this.destructor = this.destructor.bind(this)

        // handle ping
        this.StartPingTimer = this.StartPingTimer.bind(this)
        this.StopPingTimer = this.StopPingTimer.bind(this)
        this.PingRequestHandler = this.PingRequestHandler.bind(this)
        this.PingFakeRequestHandler = this.PingFakeRequestHandler.bind(this)
        this.PingResponseHandler = this.PingResponseHandler.bind(this)

        // handle incoming client or server packets
        this.StartSkillHandler = this.StartSkillHandler.bind(this)
        this.StartSkillHandler2 = this.StartSkillHandler2.bind(this)
        this.ActionStageHandler = this.ActionStageHandler.bind(this)
        this.ActionEndHandler = this.ActionEndHandler.bind(this)
        this.ReactionHandler = this.ReactionHandler.bind(this)
        this.StartCooltimeSkillHandler = this.StartCooltimeSkillHandler.bind(this)

        // helper methods
        this.UpdateLocation = this.UpdateLocation.bind(this)
        this.SendRetry = this.SendRetry.bind(this)
        this.SendActionEnd = this.SendActionEnd.bind(this)
        this.SendInstantMove = this.SendInstantMove.bind(this)
        this.CancelRetry = this.CancelRetry.bind(this)
        this.CancelActionEnd = this.CancelActionEnd.bind(this)

        this.ToggleMod = this.ToggleMod.bind(this)
        this.ToggleDebug = this.ToggleDebug.bind(this)
        this.SendPingMessage = this.SendPingMessage.bind(this)
        this.SendHelpMessage = this.SendHelpMessage.bind(this)

        this.mod.command.add("pc", {
            $default: this.SendHelpMessage,
            $none: this.ToggleMod,
            debug: this.ToggleDebug,
            ping: this.SendPingMessage,
        })

        this.mod.game.initialize("me")
        this.initialize()
    }

    ToggleMod() {
        this.enabled = !this.enabled
        if (this.enabled) {
            this.initialize()
            this.StartPingTimer()
        }
        else {
            this.destructor()
        }
        const message = "Ping Compensation " + (this.enabled ? "enabled." : "disabled.")
        this.mod.command.message(message)
    }

    ToggleDebug() {
        this.debugging = !this.debugging
        const message = "Ping Compensation debugging " + (this.debugging ? "enabled." : "disabled.")
        this.mod.command.message(message)
    }

    destructor() {
        this.StopPingTimer()
        this.CancelRetry()
        this.CancelActionEnd()

        for (let hook of this.hooks) {
            this.mod.unhook(hook)
        }
    }

    initialize() {
        this.hooks.push(this.mod.hook('S_SPAWN_ME', 'event', this.StartPingTimer))
        this.hooks.push(this.mod.hook('S_LOAD_TOPO', 'event', this.StopPingTimer))
        this.hooks.push(this.mod.hook('S_RETURN_TO_LOBBY', 'event', this.StopPingTimer))

        this.hooks.push(this.mod.hook("C_REQUEST_GAMESTAT_PING", "event", { order: 1 }, this.PingRequestHandler))
        this.hooks.push(this.mod.hook("C_REQUEST_GAMESTAT_PING", "event", { order: 1, filter: { fake: true } }, this.PingFakeRequestHandler))
        this.hooks.push(this.mod.hook("S_RESPONSE_GAMESTAT_PONG", "event", { order: 1, filter: { silenced: null } }, this.PingResponseHandler))

        this.hooks.push(this.mod.hook("S_ACTION_STAGE", "*", { order: 1 }, this.ActionStageHandler))
        this.hooks.push(this.mod.hook("S_ACTION_END", "*", { order: 1, filter: { fake: null } }, this.ActionEndHandler))
        this.hooks.push(this.mod.hook("S_START_COOLTIME_SKILL", "*", { order: 1 }, this.StartCooltimeSkillHandler))

        this.hooks.push(this.mod.hook("C_PLAYER_LOCATION", "*", { order: 1, filter: { fake: null } }, this.UpdateLocation))
        this.hooks.push(this.mod.hook("C_NOTIFY_LOCATION_IN_ACTION", "*", { order: 1, filter: { fake: null } }, this.UpdateLocation))
        this.hooks.push(this.mod.hook("S_INSTANT_MOVE", "*", { order: 1, filter: { fake: null } }, this.UpdateLocation))
        this.hooks.push(this.mod.hook("S_INSTANT_DASH", "*", { order: 1, filter: { fake: null } }, this.UpdateLocation))

        this.hooks.push(this.mod.hook("C_START_SKILL", 'raw', { order: 1 }, this.StartSkillHandler))
        this.hooks.push(this.mod.hook("C_PRESS_SKILL", 'raw', { order: 1 }, this.StartSkillHandler))
        this.hooks.push(this.mod.hook("C_START_COMBO_INSTANT_SKILL", 'raw', { order: 1 }, this.StartSkillHandler))
        this.hooks.push(this.mod.hook("C_START_INSTANCE_SKILL", 'raw', { order: 1 }, this.StartSkillHandler))
        this.hooks.push(this.mod.hook("C_START_INSTANCE_SKILL_EX", 'raw', { order: 1 }, this.StartSkillHandler))
        this.hooks.push(this.mod.hook("C_START_TARGETED_SKILL", 'raw', { order: 1 }, this.StartSkillHandler))

        this.hooks.push(this.mod.hook("C_START_SKILL", '*', { order: 2 }, this.StartSkillHandler2))
        this.hooks.push(this.mod.hook("C_PRESS_SKILL", '*', { order: 2 }, this.StartSkillHandler2))
        this.hooks.push(this.mod.hook("C_START_COMBO_INSTANT_SKILL", '*', { order: 2 }, this.StartSkillHandler2))
        this.hooks.push(this.mod.hook("C_START_INSTANCE_SKILL", '*', { order: 2 }, this.StartSkillHandler2))
        this.hooks.push(this.mod.hook("C_START_INSTANCE_SKILL_EX", '*', { order: 2 }, this.StartSkillHandler2))
        this.hooks.push(this.mod.hook("C_START_TARGETED_SKILL", '*', { order: 2 }, this.StartSkillHandler2))
    }

    StartPingTimer() {
        if (!this.skillPrediction) {
            this.StopPingTimer()
            this.pingTimer = this.mod.setInterval(() => {
                this.mod.send("C_REQUEST_GAMESTAT_PING", 1)
            }, this.pingIntervalSetting);
        }
    }

    StopPingTimer() {
        if (this.pingTimer) {
            this.mod.clearInterval(this.pingTimer)
            this.pingTimer = null
        }
    }

    SendPingMessage() {
        if (this.pingHistory.length > 0) {
            const pingAvg = Math.round(this.pingHistory.reduce((a, b) => a + b) / this.pingHistory.length)
            this.mod.command.message(`Ping Avg: ${pingAvg} ms, Min: ${this.pingMin} ms, Max: ${this.pingMax} ms`)
        }
        else {
            this.mod.command.message("Please wait 5s for ping statistics.")
            if (!this.pingTimer) this.StartPingTimer()
        }
    }

    SendHelpMessage() {
        this.mod.command.message([
            '"pc": toggles ping-compensation',
            '"pc debug": toggles debug output',
            '"pc ping": shows ping statistics',
        ].join("\n"))
    }

    PingRequestHandler() {
        this.mod.setTimeout(() => {
            this.mod.send("S_RESPONSE_GAMESTAT_PONG", 1)
        }, this.pingMin)

        this.SendPingMessage()
        return false
    }

    PingFakeRequestHandler() {
        // hook skill prediction pings instead of sending our own pings.
        if (!this.skillPrediction && this.pingWaiting && Date.now() - this.pingTime < this.pingIntervalSetting) {
            this.skillPrediction = true
            this.StopPingTimer()
        }

        if (!this.pingWaiting)
            this.pingTime = Date.now()

        this.pingWaiting = true
    }

    PingResponseHandler() {
        if (this.pingWaiting) {
            this.pingWaiting = false
            this.pingHistory.push(Date.now() - this.pingTime)

            while (this.pingHistory.length > this.pingHistorySetting)
                this.pingHistory.shift()

            this.pingMin = Math.min(...this.pingHistory)
            this.pingMax = Math.max(...this.pingHistory)
        }
        return false
    }

    UpdateLocation(event) {
        if (!event.gameId || this.mod.game.me.is(event.gameId)) {
            if (this.actionEnd) {
                this.actionEnd.loc = event.loc
                this.actionEnd.w = event.w
            }
        }
    }

    SendActionEnd() {
        this.actionEndTimer = null
        if (this.actionEnd) {
            this.sendingActionEnd = true
            this.mod.send("S_ACTION_END", "*", this.actionEnd)
        }
    }

    CancelActionEnd() {
        this.actionEnd = null
        if (this.actionEndTimer) {
            this.mod.clearTimeout(this.actionEndTimer)
            this.actionEndTimer = null
        }
    }

    SendRetry() {
        if (this.retryBuffer && this.retryCount > 0 && Date.now() < this.retryTimeout) {
            this.mod.toServer(this.retryBuffer)
            this.retryCount -= 1

            if (this.retryCount > 0) {
                this.retryTimer = this.mod.setTimeout(this.SendRetry, this.retryDelaySetting)
            }
            else {
                this.retryBuffer = null
                this.retryTimer = null

                if (this.debugging && this.actionEnd) {
                    this.retryTimer = this.mod.setTimeout(() => {
                        this.mod.error("No Action Stage after retry!")
                    }, this.pingMax)
                }
            }

            if (this.debugging) {
                this.mod.log("Start Skill retry.")
            }
        }
    }

    CancelRetry() {
        this.retryNext = false
        this.retryCount = 0
        this.retryBuffer = null
        if (this.retryTimer) {
            this.mod.clearTimeout(this.retryTimer)
            this.retryTimer = null
        }
    }

    SendInstantMove(loc, w) {
        this.mod.send("S_INSTANT_MOVE", "*", {
            gameId: this.mod.game.me.gameId,
            loc,
            w
        })
    }

    StartSkillHandler(code, data) {
        // when sending packets to server, we only duplicate legit client packets
        // to avoid undocumented edge cases sending malformed packets.
        if (this.retryNext) {
            this.retryNext = false
            this.retryBuffer = data
            // ensure some delay exists, to prevent double sending
            if (this.retryCountSetting && this.retryDelaySetting) {
                this.retryTimer = this.mod.setTimeout(this.SendRetry, this.retryDelaySetting)
            }
        }
    }

    StartSkillHandler2(event) {
        // Cancel or modify start skill retry depending on user skill config
        const templateId = this.mod.game.me.templateId
        const classIdx = templateId % 100 - 1
        const className = CLASS_NAMES[classIdx]

        const skillId = event.skill.id
        const skillBase = Math.floor(skillId / 10000)
        const skillSub = skillId % 100
        const skillConfig = this.config?.[className]?.[skillBase]?.[skillSub]

        // cancel retries for unmanaged skills if skill prediciton is used
        if (this.skillPrediction && !skillConfig) {
            this.CancelRetry()
        }

        // if config is "no retry," cancel retry, and delay skill start.
        else if (typeof skillConfig == 'string' && skillConfig.trim().toLowerCase() == "no retry") {
            // cancel retry, but keep buffer
            if (this.retryTimer) {
                this.mod.clearTimeout(this.retryTimer)
                this.retryTimer = null
            }

            // setup no retry delay, or cleanup if too late
            this.retryCount = 1
            this.retryTimeout += this.noRetryDelaySetting
            const delay = this.retryTimeout - this.retryTimeoutSetting - Date.now()
            if (delay > 0) {
                this.retryTimer = this.mod.setTimeout(this.SendRetry, delay)

                if (this.debugging) {
                    const name = this.skills?.[templateId]?.[skillId]?.name || "Unknown"
                    this.mod.log(`Block Start Skill "${name}" (${skillId})`)
                }

                return false
            }
            else {
                this.CancelRetry()
            }
        }

        if (this.debugging) {
            const name = this.skills?.[templateId]?.[skillId]?.name || "Unknown"
            this.mod.log(`Start Skill "${name}" (${skillId})`)
        }
    }

    StartCooltimeSkillHandler(event) {
        if (!this.skillPrediction) {
            const fixedCooldown = Math.max(0, event.cooldown - this.pingMin)

            if (this.debugging) {
                this.mod.log(`Cooldown reduced from ${event.cooldown} ms to ${fixedCooldown} ms.`)
            }

            event.cooldown = fixedCooldown

            return true
        }
    }

    ReactionHandler(event) {
        if (this.mod.game.me.is(event.target) && event.reaction && event.reaction.enable) {
            this.CancelRetry()
            const { loc, w } = event.reaction
            this.UpdateLocation({ loc, w })
        }
    }

    ActionEndHandler(event) {
        if (this.mod.game.me.is(event.gameId)) {
            if (this.sendingActionEnd) {
                this.sendingActionEnd = false

                // retry next skill start in-case ping dropped
                this.retryNext = true
                this.retryCount = this.retryCountSetting
                this.retryTimeout = Date.now() + this.retryTimeoutSetting

                if (this.debugging) {
                    this.mod.log(`Fake Action Ended "${this.actionName}" (${event.skill.id}).`)
                }
            }
            else if (this.actionEnd && this.actionEnd.id == event.id) {
                if (this.debugging) {
                    this.mod.log(`Real Action Ended "${this.actionName}" (${event.skill.id}).`)
                    const lengthDiff = (Date.now() - this.actionEndTime) * this.actionEndSpeed
                    if (lengthDiff > 50 || lengthDiff < -50) {
                        this.mod.error(`Expected length differed by ${lengthDiff} ms.`)
                    }
                }

                if (this.actionEndTimer) {
                    this.CancelActionEnd()
                }
                else {
                    // Teleport if fake action end was too far from real action end.
                    // Not sure if necessary, or may cause more complications if
                    // other start skill or location packets were sent in the interrim.
                    if (this.rubberBandDistSetting) {
                        const distSqr = event.loc.sqrDist2D(this.actionEnd.loc)
                        if (distSqr > this.rubberBandDistSetting * this.rubberBandDistSetting) {
                            if (this.debugging) {
                                this.mod.error(`Distance from real Action End > ${this.rubberBandDistSetting}`)
                            }
                            this.CancelRetry()
                            this.SendInstantMove(event.loc, event.w)
                        }
                    }

                    // Don't need additional retries if we know server action ended
                    this.actionEnd = null
                    this.retryNext = false
                    if (this.retryCount > 1) {
                        this.retryCount = 1
                    }

                    return false
                }
            }
        }
    }

    ActionStageHandler(event) {
        if (this.mod.game.me.is(event.gameId)) {

            this.CancelRetry()

            const templateId = event.templateId
            const classIdx = templateId % 100 - 1
            const className = CLASS_NAMES[classIdx]

            const skillId = event.skill.id
            const skillBase = Math.floor(skillId / 10000)
            const skillSub = skillId % 100

            if (this.skills?.[templateId]?.[skillId]) {
                let { name, dcType, length, distance } = this.skills[templateId][skillId]

                if (this.debugging) {
                    this.mod.log(`Action Stage "${name}" (${skillId}).`)
                    this.actionName = name
                }

                if (this.config?.[className]?.[skillBase]?.[skillSub]
                    && !DISABLED_SKILL_TYPES.includes(dcType)
                    && length > 0 && event.speed > 0
                ) {
                    length = length / event.speed
                    const fixedLength = Math.max(length - this.pingMin + this.pingOffsetSetting, 20)
                    const fixedSpeedMult = length / fixedLength
                    event.speed *= fixedSpeedMult

                    if (event.animSeq.length > 0) {
                        distance = 0
                        for (let anim of event.animSeq) {
                            anim.duration /= fixedSpeedMult
                            anim.xyRate *= fixedSpeedMult
                            distance += event.distance
                        }
                    }
                    
                    // Only set action end from first action stage
                    if (this.actionEndTimer) {
                        if (this.actionEnd && this.actionEnd.id == event.id) {
                            return true
                        }
                        else {
                            if (this.debugging) {
                                this.mod.error("New S_ACTION_STAGE without S_ACTION_END")
                                this.mod.error(event)
                            }
                            this.CancelActionEnd()
                        }
                    }

                    if (this.debugging) {
                        this.actionEndSpeed = event.speed / fixedSpeedMult
                        this.actionEndTime = Date.now() + Math.round(length)
                        this.mod.log(`Reduced length from ${Math.round(length)} ms to ${Math.round(fixedLength)} ms.`)
                    }

                    this.actionEnd = {
                        gameId: event.gameId,
                        loc: event.loc,
                        w: event.w,
                        templateId: event.templateId,
                        skill: event.skill,
                        type: 0,
                        id: event.id
                    }

                    if (distance) {
                        const dx = distance * Math.cos(event.w)
                        const dy = distance * Math.sin(event.w)
                        this.actionEnd.loc = event.loc.addN(dx, dy, 0)
                    }

                    this.actionEndTimer = this.mod.setTimeout(this.SendActionEnd, fixedLength)

                    return true
                }
            }
        }
    }
}

module.exports = PingCompensation;