import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { TrajectoryEntity } from "./trajectory";
import { TurnEntity } from "./turn";

// The provider conversation, appended to as a turn runs so that a turn
// interrupted by a restart can be replayed rather than failed.
@Entity("conversation_messages")
@Index(["trajectoryId", "sequence"], { unique: true })
export class ConversationMessageEntity {
  @PrimaryColumn("text")
  id!: string;

  @Column("text")
  trajectoryId!: string;

  @ManyToOne(() => TrajectoryEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "trajectoryId" })
  trajectory?: TrajectoryEntity;

  @Column("text")
  turnId!: string;

  @ManyToOne(() => TurnEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "turnId" })
  turn?: TurnEntity;

  @Column("integer")
  sequence!: number;

  @Column("text")
  payload!: string;

  @Column("datetime")
  createdAt!: Date;
}
