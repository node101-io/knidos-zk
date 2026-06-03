import { select } from '@inquirer/prompts';

import type { AnswerVerdict, PresentedRecord } from '../../types.js';
import { renderRecord } from '../ui/render-record.js';

const CHOICES: { name: string; value: AnswerVerdict }[] = [
  { name: 'Valid',   value: 'valid' },
  { name: 'Invalid', value: 'invalid' },
];

export async function collectAnswers(
  records: PresentedRecord[],
  compiledVkHash: string,
  previousAnswers?: AnswerVerdict[],
): Promise<AnswerVerdict[]> {
  const answers: AnswerVerdict[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i] as PresentedRecord;
    console.log('');
    console.log(renderRecord({ index: i, total: records.length, record, compiledVkHash }));
    console.log('');
    const previous = previousAnswers?.[i];
    const answer = await select<AnswerVerdict>({
      message: `Record ${i + 1}/${records.length}: valid or invalid?`,
      choices: CHOICES,
      default: previous,
    });
    answers.push(answer);
  }
  return answers;
}
