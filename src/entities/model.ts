import { Column, Entity, PrimaryColumn } from "typeorm";
import { modelEfforts, type ModelEffort } from "../models";

@Entity("models")
export class ModelEntity {
  // The OpenRouter model slug, such as "anthropic/claude-opus-5".
  @PrimaryColumn("text")
  id!: string;

  @Column("text")
  name!: string;

  @Column("text")
  provider!: string;

  @Column("simple-enum", { enum: modelEfforts })
  effort!: ModelEffort;

  @Column("datetime")
  createdAt!: Date;
}
