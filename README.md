# ResNet은 어떻게 동작하는가 — 인터랙티브 가이드

ResNet(Deep Residual Learning)의 동작 원리를 **브라우저에서 직접 실험하며** 배우는 교육 자료입니다.

**👉 보러 가기: https://dev-jonghoonpark.github.io/how-resnet-work/**

## 내용

1. **깊이의 역설** — 열화 문제(degradation problem): 층을 쌓을수록 훈련 오류가 나빠지는 현상
2. **핵심 아이디어** — 잔차 학습 `y = F(x) + x`, 애니메이션 블록 해부 다이어그램 (순전파/역전파, skip 제거 토글)
3. **신호 전파 시뮬레이터** — 무작위 네트워크에서 실제 역전파를 수행해 plain(곱셈적)과 residual(덧셈적)의 그래디언트 전파를 비교. 초기화 배율·shortcut 스케일(λ) 실험
4. **미니 학습 실험** — 같은 깊이의 plain vs residual 네트워크를 브라우저에서 실시간 훈련. 48층에서 plain이 무너지는 것을 직접 확인
5. **아키텍처 탐색기** — ResNet-18/34/50/101/152 구조, Basic vs Bottleneck 블록 파라미터 비교, ImageNet 결과
6. **ResNet v2** — pre-activation 블록 해부 다이어그램(순전파/역전파), shortcut 절제 실험(ablation), 1001층 훈련, 경로 펼쳐보기(2ⁿ개 경로)와 앙상블 관점
7. **실제 구현** — torchvision `resnet.py` 코드 해설과 공개 구현체 링크

순수 HTML/CSS/JavaScript로 작성되었으며 외부 라이브러리 의존성이 없습니다.
모든 시뮬레이션(역전파, 신경망 훈련)은 방문자의 브라우저에서 실시간으로 계산됩니다.
라이트/다크 모드를 지원합니다.

## 참고 문헌

- He, Zhang, Ren, Sun. *Deep Residual Learning for Image Recognition.* CVPR 2016. [arXiv:1512.03385](https://arxiv.org/abs/1512.03385)
- He, Zhang, Ren, Sun. *Identity Mappings in Deep Residual Networks.* ECCV 2016. [arXiv:1603.05027](https://arxiv.org/abs/1603.05027)
- Yu, Koltun. *Multi-Scale Context Aggregation by Dilated Convolutions.* ICLR 2016. [arXiv:1511.07122](https://arxiv.org/abs/1511.07122)
- Veit, Wilber, Belongie. *Residual Networks Behave Like Ensembles of Relatively Shallow Networks.* NeurIPS 2016. [arXiv:1605.06431](https://arxiv.org/abs/1605.06431)

## 참고 구현체

- [pytorch/vision — resnet.py](https://github.com/pytorch/vision/blob/main/torchvision/models/resnet.py)
- [KaimingHe/deep-residual-networks](https://github.com/KaimingHe/deep-residual-networks) (저자 공식)
- [KaimingHe/resnet-1k-layers](https://github.com/KaimingHe/resnet-1k-layers) (ResNet v2 공식)

## 로컬 실행

```bash
python3 -m http.server 8000
# http://localhost:8000 접속
```
