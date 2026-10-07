import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest


SCRIPT_PATH = Path(__file__).parents[1] / 'scripts' / 'finetune_gemma3.py'
SPEC = importlib.util.spec_from_file_location('soma_finetune_gemma3', SCRIPT_PATH)
FINETUNE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FINETUNE)


class _FakeDataset:
    def __init__(self):
        self.column_names = ['messages', 'metadata']
        self.removed_columns = []

    def remove_columns(self, columns):
        self.removed_columns.extend(columns)
        self.column_names = [name for name in self.column_names if name not in columns]
        return self

    def map(self, *_args, **_kwargs):
        return self

    def train_test_split(self, test_size):
        assert test_size == 0.05
        return {'train': ['train'], 'test': ['test']}


class FineTuneTempCleanupTests(unittest.TestCase):
    def test_lobe_dataset_loads_sources_directly_without_merged_temp_file(self):
        with tempfile.TemporaryDirectory() as root:
            final_dir = Path(root) / 'FINAL'
            final_dir.mkdir()
            record = {
                'messages': [
                    {'role': 'system', 'content': 'system'},
                    {'role': 'user', 'content': 'question'},
                    {'role': 'assistant', 'content': 'answer'},
                ],
                'metadata': {'source': 'test'},
            }
            sources = []
            for index in range(2):
                source = final_dir / f'lobe-logos-final-{index}.jsonl'
                source.write_text(json.dumps(record) + '\n', encoding='utf-8')
                sources.append(str(source))

            captured = {}
            dataset = _FakeDataset()
            original_loader = getattr(FINETUNE, 'load_dataset', None)

            def fake_loader(kind, data_files, split):
                captured.update(kind=kind, data_files=data_files, split=split)
                return dataset

            FINETUNE.load_dataset = fake_loader
            try:
                train, validation = FINETUNE.prepare_dataset(root, object(), 512, lobe='logos')
            finally:
                if original_loader is None:
                    delattr(FINETUNE, 'load_dataset')
                else:
                    FINETUNE.load_dataset = original_loader

            self.assertEqual(captured['kind'], 'json')
            self.assertEqual(captured['split'], 'train')
            self.assertEqual(captured['data_files'], sources)
            self.assertEqual(dataset.removed_columns, ['metadata'])
            self.assertEqual(train, ['train'])
            self.assertEqual(validation, ['test'])

    def test_scavenger_removes_only_stale_soma_training_directories(self):
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            stale = root_path / 'soma-training-runtime-stale'
            fresh = root_path / 'soma-training-runtime-fresh'
            unrelated = root_path / 'other-application-temp'
            for directory in (stale, fresh, unrelated):
                directory.mkdir()
                (directory / 'payload').write_text('data', encoding='utf-8')

            old = time.time() - 8 * 60 * 60
            os.utime(stale, (old, old))
            FINETUNE._cleanup_stale_training_runtime_dirs(
                max_age_seconds=6 * 60 * 60,
                temp_root=root_path,
            )

            self.assertFalse(stale.exists())
            self.assertTrue(fresh.exists())
            self.assertTrue(unrelated.exists())


if __name__ == '__main__':
    unittest.main()
