import type { ArgumentMetadata, PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * Valida o payload contra um schema Zod e devolve o valor **já tipado**.
 *
 * Escrito à mão em vez de `nestjs-zod`: são 10 linhas úteis, e a dependência
 * seria acoplada à major do Zod — que este projeto já subiu uma vez (v3 → v4).
 *
 * Não trata o erro: deixa o `ZodError` subir para o `AllExceptionsFilter`, que
 * é o único lugar que sabe qual formato de resposta cada rota deve devolver.
 * Essa separação é o que substitui o `try/catch` repetido nos 5 controllers.
 *
 * Sem `@Injectable()` de propósito: o schema vem pelo construtor, então o pipe é
 * sempre instanciado à mão por parâmetro
 * (`@Body(new ZodValidationPipe(gameSearchSchema))`) e nunca passa pelo
 * container. O decorator seria enfeite.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
	constructor(private readonly schema: ZodType<T>) {}

	transform(value: unknown, _metadata: ArgumentMetadata): T {
		return this.schema.parse(value);
	}
}
