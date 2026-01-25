import json
from pathlib import Path
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib

DATA = Path(__file__).resolve().parent / "topic_examples.jsonl"
OUT_MODEL = Path(__file__).resolve().parent.parent / "Backend" / "topic_classifier.pkl"

def load_data(path):
    xs, ys = [], []
    with open(path, "r", encoding="utf8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            js = json.loads(line)
            xs.append(js["text"])
            ys.append(js["label"])
    return xs, ys

def main():
    X, y = load_data(DATA)
    if len(X) < 4:
        print("Not enough data to train")
        return
    # handle small datasets: only stratify when dataset size permits
    n_classes = len(set(y))
    test_size = max(1, int(len(X) * 0.2))
    # only stratify when dataset size and test_size are large enough to contain each class
    strat = y if (len(X) >= (n_classes * 2) and test_size >= n_classes) else None
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size, random_state=42, stratify=strat)
    pipe = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1,2), max_features=20000)),
        ("clf", LogisticRegression(max_iter=1000, class_weight="balanced"))
    ])
    print("Training classifier on", len(X_train), "examples")
    pipe.fit(X_train, y_train)
    preds = pipe.predict(X_test)
    print("Evaluation:")
    print(classification_report(y_test, preds))
    joblib.dump(pipe, OUT_MODEL)
    print("Saved model to", OUT_MODEL)

if __name__ == "__main__":
    main()
