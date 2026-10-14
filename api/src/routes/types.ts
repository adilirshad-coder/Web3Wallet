import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";

export type TypeBoxFastify = FastifyInstance<any, any, any, any, TypeBoxTypeProvider>;
