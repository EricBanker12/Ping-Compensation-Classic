## Ping Compensation (Classic)
This is a rewrite of the original [Ping Compensation](https://github.com/EricBanker12/ping-compensation/), a Tera-Toolbox mod for classic TERA private servers based on patch 31.04. This mod gives you fake attack speed to eliminate ping tax between skills.
### Comparison to Skill Prediction
For eliminating the ping tax on player input, Skill Prediction is better in every way. However, Skill Prediction can cause ghosting\* and increased desync, which is especially harmful for PvP. I made Ping Compensation as an alternative to still gain some of the ping tax reduction benefits, but without the downsides. With Ping Compensation, because all actions are still validated by the server, skills cannot ghost and cause increased desync. Recommended for players with ping between 50 to 150 ms.

Ping Compensation | Skill Prediction
:--:|:--:
No ghosting\* | Occasional ghosting\*
Less fluid animations | More fluid animations
Partial benefit For chained skills | Full benefit For chained skills
Partial benefit For charged skills | Full benefit For charged skills
Partial benefit For lock-on skills | Full benefit For lock-on skills
No benefit For blocking skills | Full benefit For blocking skills

\* Ghosting is when a skill is used client-side, but no action, or a different action (i.e. staggered), is used server-side. Ghosting skills with movement or crowd-control immunity (i.e. Retaliate) can lead to increased desync.
### Diagram
![No Toolbox vs Skill Prediction vs Ping Compensation](https://i.imgur.com/yXttYwv.png)
### Requirements
[Tera-Toolbox](https://github.com/tera-classic-toolbox/tera-toolbox)