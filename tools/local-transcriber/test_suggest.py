import unittest
from suggest import candidates, extract
class CandidateTests(unittest.TestCase):
    def test_minimal_candidate_keeps_original(self):
        rows=[{'start':0,'end':1,'text':'情報をタプニーします。'}]
        out,rejected=candidates(rows,[{'id':0,'before':'タプニー','after':'確認','reason':'文脈候補'}],{0})
        self.assertEqual(out[0]['suggestion'],'情報を確認します。')
        self.assertEqual(out[0]['text'],rows[0]['text']);self.assertFalse(rejected)
    def test_facts_ambiguous_and_unknown_ids_rejected(self):
        rows=[{'text':'15万円で、未承認です。'},{'text':'確認、確認'}]
        edits=[{'id':0,'before':'15','after':'10','reason':'推測'},{'id':0,'before':'未承認','after':'承認','reason':'推測'},{'id':1,'before':'確認','after':'承認','reason':'曖昧'},{'id':9,'before':'a','after':'b','reason':'不明'}]
        out,rejected=candidates(rows,edits,{0,1})
        self.assertEqual(len(rejected),4);self.assertTrue(all('suggestion' not in r for r in out))
    def test_named_entity_context_is_not_rewritten(self):
        rows=[{'text':'タプニーという社名です。'}]
        out,rejected=candidates(rows,[{'id':0,'before':'タプニー','after':'確認','reason':'文脈'}],{0})
        self.assertEqual(rejected,['named-entity-context']);self.assertNotIn('suggestion',out[0])
    def test_invalid_output(self):
        with self.assertRaises(ValueError):extract('回答が切れた {"edits":[')
        self.assertEqual(extract('進捗\n{"edits":[]}\n終了'),{'edits':[]})
if __name__=='__main__':unittest.main()
