import { generateAsyncApiSpec } from "../src/asyncapi-generator.ts";

const spec = generateAsyncApiSpec() as Record<string, unknown>;

// The AsyncAPI @asyncapi/specs 3.0.0 schema has `additionalProperties: false`
// on messageTraits and does not include `payload` as a valid field, so the CLI
// generator rejects the raw spec. Strip `payload` from every messageTrait entry
// before writing — each message already carries its own full `payload` schema
// via `enveloped()`, so the trait payload is purely redundant documentation.
const components = spec["components"] as Record<string, unknown> | undefined;
if (components) {
	const messageTraits = components["messageTraits"] as
		| Record<string, Record<string, unknown>>
		| undefined;
	if (messageTraits) {
		for (const trait of Object.values(messageTraits)) {
			delete trait["payload"];
		}
	}
}

const json = JSON.stringify(spec, null, 2);
await Bun.write("asyncapi.json", json);
console.log("Wrote asyncapi.json");
