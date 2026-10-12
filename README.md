# Views que não parecem humanas

A marca paga por alcance. Pico comprado, repetição mecânica e queda abrupta inflam o número. Falso positivo também custa: vídeo que estourou de verdade não pode ser punido. Esta API recebe a série de views por hora e devolve a classificação, o motivo em português e os sinais usados. Sem modelo opaco e sem rede social.

Comece a leitura por [`src/classify.ts`](src/classify.ts) e pela saída de `npm run dataset`.

## Regras

`classify` é uma função pura. As regras rodam nesta ordem:

1. Menos de 12 pontos → `inconclusive`: a amostra é curta e não acusa. Se a série tem lacunas, só o maior trecho de horas consecutivas é analisado (sinal `gaps`); com menos de 12 horas seguidas, `inconclusive`. Seis observações espalhadas por dez dias não são "seis horas seguidas".
2. 6 horas seguidas ou mais com o mesmo inteiro, e esse inteiro `>= 300` → `suspicious`, sinal `mechanical_repeat`.
3. Se o pico isolado (regra 4 ou 5) é a última hora da série → `inconclusive`: sem a hora seguinte não dá para ver se ele some, como compra, ou se sustenta, como um vídeo estourando.
4. Pico isolado: máximo `>= 1000`, máximo `>= 20` vezes a mediana das outras horas, cada vizinho `<= 20%` do pico, e menos de 3 horas com `>= 40%` do pico → `suspicious`, sinal `isolated_spike`.
5. Pico isolado que não passa o limiar do item 4, mas com máximo `>= 5` vezes a mediana → `inconclusive`: abaixo do limiar de compra, prefere não acusar.
6. Queda abrupta: 3 horas seguidas acima de 3 vezes a mediana e de 200 views que caem para 20% ou menos de uma hora para a outra → `inconclusive`, sinal `abrupt_drop`. Público humano esfria aos poucos, mas o fim de uma live também corta assim; junto com repetição mecânica a série já é `suspicious` pela regra 2.
7. 3 horas ou mais com `>= 40%` do pico, sem repetição mecânica → `legitimate`: o pico se sustenta.
8. Nenhum sinal → `legitimate`: não há repetição mecânica nem pico comprado.

Pico orgânico sustentado (regra 7) e pico de uma hora (regra 4) nunca caem na mesma classe. Cada limiar tem teste de fronteira (6 horas disparam, 5 não; 300 views sim, 299 não; 1000 sim, 999 não; 20 vezes a mediana sim, 19,9 não; vizinho em 20% sim, 21% não).

**Contrato da entrada:** cada ponto é um bucket de hora cheia (minuto, segundo e milissegundo zero, em qualquer offset), sem hora repetida, com `views` inteiro seguro `>= 0`. No máximo 2160 horas (90 dias) por série → senão 400. Corpo acima de 256 KiB → 413, com ou sem `Content-Length`. O pico é calculado num laço, sem `Math.max(...views)`, que estoura a pilha em séries grandes.

## O que isto não pega

- Compra lenta, espalhada em várias horas, com decaimento parecido com o orgânico. Isso está medido: a família `slow_buy` do dataset passa inteira como `legitimate`, e é por ela que o acerto nas suspeitas fica em 80%.
- Volume baixo: um pico comprado abaixo de 1000 views fica `inconclusive`, não `suspicious`.
- Ruído somado em cima de uma curva orgânica: views compradas que seguem a forma do público real.
- Queda abrupta sozinha não acusa: fim de live (família `live_end`) e compra que para de uma vez têm o mesmo desenho, então os dois ficam `inconclusive`.

## Critérios do enunciado → testes

| Critério ou entrega | Teste |
| --- | --- |
| Motivo legível sem conhecer o código | `uma série de pico comprado é suspicious e o motivo cita o pico`, `…o motivo cita repetição` |
| Taxa do README sai do comando | `a taxa de falso positivo medida é a mesma linha do README`, `o bloco do README é a saída de npm run dataset` |
| Pico orgânico e pico comprado em baldes diferentes | `a orgânica que estourou e a comprada não caem na mesma classificação` |
| Documenta o que não detecta | família `slow_buy` e `compra lenta com forma de viral passa despercebida, como o README declara` |
| Caso em que prefere não acusar | `o caso limítrofe é inconclusive`, `fim de live, com queda abrupta, nunca é acusado`, `pico comprado na última hora fica inconclusivo` |
| Dataset reproduzível | `duas gerações com a semente 7 produzem o mesmo JSON`, hash das 220 séries originais |

## Decisões que eu deixaria diferentes com mais tempo

- **Limiares calibrados.** Os limiares vieram do plano e passam no dataset, mas não foram escolhidos por calibração numa partição separada; com mais tempo, calibraria numa partição e mediria na outra.
- **Ritmo do público.** O classificador não usa o ciclo dia/noite; um lote comprado de madrugada num canal de público diurno é um sinal que ele ignora.
- **Compra lenta.** Pegar `slow_buy` exige olhar outra coisa além da forma da curva (retenção, origem do tráfego), que esta API não recebe.

## Como rodar

Node 22.13 ou maior (primeira versão com `node:sqlite` sem flag).

```bash
npm install
npm run dataset
npm test
npm run typecheck
npm run dev
```

A API sobe em `http://127.0.0.1:43127`.

## Dataset

`src/dataset.ts` gera 300 séries com `mulberry32`, semente fixa `7`, e guarda o rótulo ao lado de cada uma:

- `organic` (120, `legitimate`): base, subida, 4 horas perto do pico, decaimento por 0,75. Uma passagem quebra sequências de valores iguais antes de chegarem a 6, para o arredondamento não fabricar platô.
- `bought_spike` (40, `suspicious`): 48 horas na base e uma hora a 80 vezes a base, acima de 1000.
- `mechanical` (40, `suspicious`): um miolo de 8 horas com o mesmo inteiro `>= 300`.
- `borderline` (20, `borderline`): uma hora a 8 vezes a base. Não entra na taxa de falso positivo.
- `live_end` (20, `legitimate`): live de 4 a 8 horas com corte seco no fim. A queda abrupta sozinha deve ficar inconclusiva, nunca suspeita.
- `day_night` (20, `legitimate`): 3 dias de público subindo de dia e caindo de madrugada.
- `small_creator` (20, `legitimate`): menos de 15 views por hora.
- `slow_buy` (20, `suspicious`): compra lenta com subida e decaimento iguais aos de um viral. **O classificador não pega** essa família, e ela entra na medição para o "acerto nas suspeitas" mostrar isso com número.

`npm run dataset` grava `dataset/views.json` e imprime o bloco abaixo. O teste `o bloco do README é a saída de npm run dataset` compara o bloco inteiro, linha a linha, com o cálculo; se o classificador ou o gerador mudarem e o README ficar velho, o teste quebra.

<!-- dataset:inicio -->
```text
Séries: 300 (semente 7), gravadas em dataset/views.json
organic (legitimate): legitimate 120, suspicious 0, inconclusive 0
bought_spike (suspicious): legitimate 0, suspicious 40, inconclusive 0
mechanical (suspicious): legitimate 0, suspicious 40, inconclusive 0
borderline (borderline): legitimate 0, suspicious 0, inconclusive 20
live_end (legitimate): legitimate 0, suspicious 0, inconclusive 20
day_night (legitimate): legitimate 20, suspicious 0, inconclusive 0
small_creator (legitimate): legitimate 20, suspicious 0, inconclusive 0
slow_buy (suspicious): legitimate 20, suspicious 0, inconclusive 0
Falso positivo no dataset: 0.0000
Limite superior de 95% do falso positivo: 0.0203 (0 de 180 legítimas acusadas)
Acerto nas suspeitas: 0.8000 (80 de 100)
```
<!-- dataset:fim -->

O limite superior é o do intervalo de Clopper-Pearson de 95%: com 0 acusações em 180 legítimas, a taxa real de falso positivo nesse tipo de série pode chegar a cerca de 2%, não a zero.

A taxa é `legitimate` classificadas como `suspicious` sobre o total de `legitimate`. O teste `a taxa de falso positivo medida é a mesma linha do README` recalcula a taxa e compara com a linha acima. Se o classificador mudar e este README ficar velho, o teste quebra.

## Exemplo

O teste `exemplo do README: 12 horas perto de 40 views e uma hora com 2000 é pico comprado` executa este request.

```bash
curl -s -X POST http://127.0.0.1:43127/classifications \
  -H 'content-type: application/json' \
  -d '{"points":[{"hour":"2026-06-01T00:00:00.000Z","views":40},{"hour":"2026-06-01T01:00:00.000Z","views":38},{"hour":"2026-06-01T02:00:00.000Z","views":42},{"hour":"2026-06-01T03:00:00.000Z","views":41},{"hour":"2026-06-01T04:00:00.000Z","views":39},{"hour":"2026-06-01T05:00:00.000Z","views":2000},{"hour":"2026-06-01T06:00:00.000Z","views":45},{"hour":"2026-06-01T07:00:00.000Z","views":40},{"hour":"2026-06-01T08:00:00.000Z","views":37},{"hour":"2026-06-01T09:00:00.000Z","views":43},{"hour":"2026-06-01T10:00:00.000Z","views":41},{"hour":"2026-06-01T11:00:00.000Z","views":39}]}'
```

Resposta `200`:

```json
{
  "classification": "suspicious",
  "reason": "Pico isolado de 2000 views, 50 vezes a mediana das outras horas, que some na hora seguinte. Parece views compradas, não alcance orgânico.",
  "signals": [
    { "name": "mechanical_repeat", "fired": false, "detail": "nenhuma sequência de 6 horas iguais com 300 views ou mais" },
    { "name": "isolated_spike", "fired": true, "detail": "pico de 2000 views em 2026-06-01T05:00:00.000Z, 50x a mediana das outras horas (40), 1 hora(s) com 40% do pico ou mais" },
    { "name": "weak_spike", "fired": false, "detail": "limiar de compra: pico >= 1000 views e >= 20x a mediana" },
    { "name": "sustained_peak", "fired": false, "detail": "1 hora(s) com 40% do pico ou mais; sustentação pede 3" }
  ]
}
```

## Ficou de fora

Os três casos listados em "O que isto não pega", sazonalidade por dia da semana e séries com horas faltando.

## Nota da entrega

Comece por `src/classify.ts` e pela saída de `npm run dataset`. A classificação é uma sequência de regras legíveis, e cada resposta traz o motivo em português e os sinais que dispararam ou não. A escolha central é não punir vídeo que estourou: pico que se sustenta por 3 horas ou mais com 40% do topo é `legitimate`, pico de uma hora com 20 vezes a mediana e mais de 1000 views é `suspicious`, e o pico isolado que fica abaixo desse limiar volta `inconclusive` em vez de acusar. Amostra com menos de 12 horas também é `inconclusive`. A taxa de falso positivo do README não foi escrita à mão: é a linha que `npm run dataset` imprime sobre 300 séries geradas com semente 7, e um teste compara a linha com a taxa recalculada.

Testes: `npm test` com 44 passando, `npm run typecheck` sem erro. O exemplo deste README é o request de um teste.

Ficou de fora: compra lenta com decaimento orgânico, volume baixo e ruído sobre curva orgânica.

IA: código, testes e README escritos com assistente de código (Claude Code), a partir de um plano com as regras do desafio. O assistente rodou `npm run dataset`, os testes e o typecheck e copiou a saída acima. O contrato de cadência horária e os limites de entrada vieram de programação em pares: o Codex auditou a entrega e escreveu os testes que reproduziam os defeitos; o Claude Code implementou, validou e publicou. A taxa do dataset não mudou.
