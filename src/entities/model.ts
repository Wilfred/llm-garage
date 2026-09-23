import { Column, Entity, PrimaryColumn } from "typeorm";
import {
  modelEfforts,
  modelProviders,
  type ModelEffort,
  type ModelProvider,
} from "../models";

@Entity("models")
export class ModelEntity {
  // The provider's model slug, such as "anthropic/claude-opus-5" on
  // OpenRouter or "gpt-5.5" on a ChatGPT subscription.
  @PrimaryColumn("text")
  id!: string;

  @Column("text")
  name!: string;

  @Column("simple-enum", { enum: modelProviders, default: "openrouter" })
  provider!: ModelProvider;

  @Column("simple-enum", { enum: modelEfforts })
  effort!: ModelEffort;

  @Column("datetime")
  createdAt!: Date;
}
