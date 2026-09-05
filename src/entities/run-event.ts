import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { SessionEntity } from "./session";
import { TurnEntity } from "./turn";

export const runEventKinds = [
  "log",
  "status",
  "system",
  "model_output",
  "tool",
  "usage",
] as const;

@Entity("run_events")
@Index(["sessionId", "sequence"], { unique: true })
@Index(["turnId", "sequence"])
export class RunEventEntity {
  @PrimaryColumn("text")
  id!: string;

  @Column("text")
  sessionId!: string;

  @ManyToOne(() => SessionEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "sessionId" })
  session?: SessionEntity;

  @Column("text")
  turnId!: string;

  @ManyToOne(() => TurnEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "turnId" })
  turn?: TurnEntity;

  @Column("integer")
  sequence!: number;

  @Column("simple-enum", { enum: runEventKinds })
  kind!: (typeof runEventKinds)[number];

  @Column("text")
  data!: string;

  @Column("datetime")
  ts!: Date;
}
