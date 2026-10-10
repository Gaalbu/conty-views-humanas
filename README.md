# Views que não parecem humanas

A marca paga por alcance. Pico comprado, repetição mecânica e queda abrupta inflam o número. Falso positivo também custa: vídeo que estourou de verdade não pode ser punido. Esta API recebe a série de views por hora e devolve a classificação, o motivo em português e os sinais usados. Sem modelo opaco e sem rede social.

Comece a leitura por [`src/classify.ts`](src/classify.ts) e pela saída de `npm run dataset`.

## Regras

`classify` é uma função pura. As regras rodam nesta ordem:

1. Menos de 12 pontos → `inconclusive`: a amostra é curta e não acusa.
2. 6 horas seguidas ou mais com o mesmo inteiro, e esse inteiro `>= 300` → `suspicious`, sinal `mechanical_repeat`.
3. Pico isolado: máximo `>= 1000`, máximo `>= 20` vezes a mediana das outras horas, cada vizinho `<= 20%` do pico, e menos de 3 horas com `>= 40%` do pico → `suspicious`, sinal `isolated_spike`.
4. Pico isolado que não passa o limiar do item 3, mas com máximo `>= 5` vezes a mediana → `inconclusive`: abaixo do limiar de compra, prefere não acusar.
5. 3 horas ou mais com `>= 40%` do pico, sem repetição mecânica → `legitimate`: o pico se sustenta.
6. Nenhum sinal → `legitimate`: não há repetição mecânica nem pico comprado.

Pico orgânico sustentado (regra 5) e pico de uma hora (regra 3) nunca caem na mesma classe.

## O que isto não pega

- Compra lenta, espalhada em várias horas, com decaimento parecido com o orgânico.
- Volume baixo: um pico comprado abaixo de 1000 views fica `inconclusive`, não `suspicious`.
- Ruído somado em cima de uma curva orgânica: views compradas que seguem a forma do público real.

## Como rodar

Node 22 ou maior.

```bash
npm install
npm run dataset
npm test
npm run typecheck
npm run dev
```

A API sobe em `http://127.0.0.1:43127`.

## Dataset

`src/dataset.ts` gera 220 séries com `mulberry32`, semente fixa `7`, e guarda o rótulo ao lado de cada uma:

- `organic` (120, rótulo `legitimate`): base, subida, 4 horas perto do pico, decaimento por 0,75. Uma passagem quebra sequências de valores iguais antes de chegarem a 6, para o arredondamento não fabricar platô.
- `bought_spike` (40, `suspicious`): 48 horas na base e uma hora a 80 vezes a base, acima de 1000.
- `mechanical` (40, `suspicious`): um miolo de 8 horas com o mesmo inteiro `>= 300`.
- `borderline` (20, `borderline`): uma hora a 8 vezes a base. Não entra na taxa de falso positivo.

`npm run dataset` grava `dataset/views.json` e imprime, nesta execução:

```text
Séries: 220 (semente 7), gravadas em dataset/views.json
organic: legitimate 120, suspicious 0, inconclusive 0
bought_spike: legitimate 0, suspicious 40, inconclusive 0
mechanical: legitimate 0, suspicious 40, inconclusive 0
borderline: legitimate 0, suspicious 0, inconclusive 20
Falso positivo no dataset: 0.0000
```

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

Comece por `src/classify.ts` e pela saída de `npm run dataset`. A classificação é uma sequência de regras legíveis, e cada resposta traz o motivo em português e os sinais que dispararam ou não. A escolha central é não punir vídeo que estourou: pico que se sustenta por 3 horas ou mais com 40% do topo é `legitimate`, pico de uma hora com 20 vezes a mediana e mais de 1000 views é `suspicious`, e o pico isolado que fica abaixo desse limiar volta `inconclusive` em vez de acusar. Amostra com menos de 12 horas também é `inconclusive`. A taxa de falso positivo do README não foi escrita à mão: é a linha que `npm run dataset` imprime sobre 220 séries geradas com semente 7, e um teste compara a linha com a taxa recalculada.

Testes: `npm test` com 10 passando, `npm run typecheck` sem erro. O exemplo deste README é o request de um teste.

Ficou de fora: compra lenta com decaimento orgânico, volume baixo e ruído sobre curva orgânica.

IA: código, testes e README escritos com assistente de código (Claude Code), a partir de um plano com as regras do desafio. O assistente rodou `npm run dataset`, os testes e o typecheck e copiou a saída acima.
